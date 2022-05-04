// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.6.11;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

import "./Pools/StablecoinPool.sol";
import "../Oracle/UniswapPairOracle.sol";
import "../Oracle/ChainlinkETHUSDPriceConsumer.sol";
import "../tools/AbstractPausable.sol";

contract RStablecoin is ERC20Burnable, AbstractPausable {
    using SafeMath for uint256;

    event StableBurned(address indexed from, address indexed to, uint256 amount);
    event StableMinted(address indexed from, address indexed to, uint256 amount);

    event CollateralRatioRefreshed(uint256 globalCollateralRatio);
    event PoolAdded(address pool_address);
    event PoolRemoved(address pool_address);
    event RedemptionFeeSet(uint256 red_fee);
    event MintingFeeSet(uint256 min_fee);
    event StableStepSet(uint256 new_step);
    event PriceTargetSet(uint256 new_price_target);
    event RefreshCooldownSet(uint256 new_cooldown);
    event StockAddressSet(address _fxs_address);
    event ETHUSDOracleSet(address eth_usd_consumer_address);
    event TimelockSet(address new_timelock);
    event ControllerSet(address controller_address);
    event PriceBandSet(uint256 price_band);
    event StableETHOracleSet(address oracle_addr, address weth_address);
    event StockEthOracleSet(address oracle_addr, address weth_address);

    uint256 public constant GENESIS_SUPPLY = 2000000e18; // 2M FRAX (only for testing, genesis supply will be 5k on Mainnet). This is to help with establishing the Uniswap pools, as they need liquidity
    // Constants for various precisions
    uint256 private constant PRICE_PRECISION = 1e6;

    enum PriceChoice {STABLE, STOCK}
    ChainlinkETHUSDPriceConsumer private ethUsdPricer;
    uint8 private ethUsdPricerDecimals;
    UniswapPairOracle private stableEthOracle;
    UniswapPairOracle private stockEthOracle;

    address public stockAddress;
    address public stableEthOracleAddress;
    address public stockEthOracleAddress;
    address public weth;
    address public ethUsdConsumerAddress;


    // The addresses in this array are added by the oracle and these contracts are able to mint frax
    address[] public poolAddress;

    // Mapping is also used for faster verification
    mapping(address => bool) public isStablePools;


    uint256 public globalCollateralRatio; // 6 decimals of precision, e.g. 924102 = 0.924102
    uint256 public redemptionFee; // 6 decimals of precision, divide by 1000000 in calculations for fee
    uint256 public mintingFee; // 6 decimals of precision, divide by 1000000 in calculations for fee
    uint256 public stableStep; // Amount to change the collateralization ratio by upon refreshCollateralRatio()
    uint256 public refreshCooldown; // Seconds to wait before being able to run refreshCollateralRatio() again
    uint256 public priceTarget; // The price of FRAX at which the collateral ratio will respond to; this value is only used for the collateral ratio mechanism and not for minting and redeeming which are hardcoded at $1
    uint256 public priceBand; // The bound above and below the price target at which the refreshCollateralRatio() will not change the collateral ratio

    uint256 public lastCallTime; // Last time the refreshCollateralRatio function was called

    modifier onlyPools() {
        require(isStablePools[msg.sender] == true, "Only frax pools can call this function");
        _;
    }

    modifier onlyByOwnerGovernanceOrPool() {
        require(
            msg.sender == owner()
            || isStablePools[msg.sender] == true,
            "Not the owner, the governance timelock, or a pool");
        _;
    }

    constructor (
        address _operatorMsg,
        string memory _name,
        string memory _symbol

    ) public ERC20(_name, _symbol) AbstractPausable(_operatorMsg){
        _mint(msg.sender, GENESIS_SUPPLY);
        stableStep = 2500;
        // 6 decimals of precision, equal to 0.25%
        globalCollateralRatio = 1000000;
        // Frax system starts off fully collateralized (6 decimals of precision)
        refreshCooldown = 3600;
        // Refresh cooldown period is set to 1 hour (3600 seconds) at genesis
        priceTarget = 1000000;
        // Collateral ratio will adjust according to the $1 price target at genesis
        priceBand = 5000;
        // Collateral ratio will not adjust if between $0.995 and $1.005 at genesis
    }

    // Choice = 'FRAX' or 'FXS' for now
    function oraclePrice(PriceChoice choice) internal view returns (uint256) {
        // Get the ETH / USD price first, and cut it down to 1e6 precision
        uint256 __eth_usd_price = uint256(ethUsdPricer.getLatestPrice()).mul(PRICE_PRECISION).div(uint256(10) ** ethUsdPricerDecimals);
        uint256 price_vs_eth = 0;

        if (choice == PriceChoice.STABLE) {
            price_vs_eth = uint256(stableEthOracle.consult(weth, PRICE_PRECISION));
            // How much FRAX if you put in PRICE_PRECISION WETH
        }
        else if (choice == PriceChoice.STOCK) {
            price_vs_eth = uint256(stockEthOracle.consult(weth, PRICE_PRECISION));
            // How much FXS if you put in PRICE_PRECISION WETH
        }
        else revert("INVALID PRICE CHOICE. Needs to be either 0 (FRAX) or 1 (FXS)");

        // Will be in 1e6 format
        return __eth_usd_price.mul(PRICE_PRECISION).div(price_vs_eth);
    }

    // Returns X FRAX = 1 USD
    function stablePrice() public view returns (uint256) {
        return oraclePrice(PriceChoice.STABLE);
    }

    // Returns X FXS = 1 USD
    function stockPrice() public view returns (uint256) {
        return oraclePrice(PriceChoice.STOCK);
    }

    function ethUsdPrice() public view returns (uint256) {
        return uint256(ethUsdPricer.getLatestPrice()).mul(PRICE_PRECISION).div(uint256(10) ** ethUsdPricerDecimals);
    }

    // This is needed to avoid costly repeat calls to different getter functions
    // It is cheaper gas-wise to just dump everything and only use some of the info
    function stableInfo() public view returns (uint256, uint256, uint256, uint256, uint256, uint256, uint256, uint256) {
        return (
        oraclePrice(PriceChoice.STABLE), // frax_price()
        oraclePrice(PriceChoice.STOCK), // fxs_price()
        totalSupply(), // totalSupply()
        globalCollateralRatio, // globalCollateralRatio()
        globalCollateralValue(), // globalCollateralValue
        mintingFee, // minting_fee()
        redemptionFee, // redemption_fee()
        uint256(ethUsdPricer.getLatestPrice()).mul(PRICE_PRECISION).div(uint256(10) ** ethUsdPricerDecimals) //eth_usd_price
        );
    }

    function stablePoolAddressCount() public view returns (uint256) {
        return (poolAddress.length);
    }

    // Iterate through all frax pools and calculate all value of collateral in all pools globally 
    function globalCollateralValue() public view returns (uint256) {
        uint256 total_collateral_value_d18 = 0;

        for (uint i = 0; i < poolAddress.length; i++) {
            // Exclude null addresses
            if (poolAddress[i] != address(0)) {
                total_collateral_value_d18 = total_collateral_value_d18.add(StablecoinPool(poolAddress[i]).collatDollarBalance());
            }

        }
        return total_collateral_value_d18;
    }

    /* ========== PUBLIC FUNCTIONS ========== */

    // There needs to be a time interval that this can be called. Otherwise it can be called multiple times per expansion.

    function refreshCollateralRatio() public whenNotPaused {
        uint256 stablePriceCur = stablePrice();
        require(block.timestamp - lastCallTime >= refreshCooldown, "Must wait for the refresh cooldown since last refresh");

        // Step increments are 0.25% (upon genesis, changable by setStableStep())

        if (stablePriceCur > priceTarget.add(priceBand)) {//decrease collateral ratio
            if (globalCollateralRatio <= stableStep) {//if within a step of 0, go to 0
                globalCollateralRatio = 0;
            } else {
                globalCollateralRatio = globalCollateralRatio.sub(stableStep);
            }
        } else if (stablePriceCur < priceTarget.sub(priceBand)) {//increase collateral ratio
            if (globalCollateralRatio.add(stableStep) >= 1000000) {
                globalCollateralRatio = 1000000;
                // cap collateral ratio at 1.000000
            } else {
                globalCollateralRatio = globalCollateralRatio.add(stableStep);
            }
        }

        lastCallTime = block.timestamp;
        // Set the time of the last expansion

        emit CollateralRatioRefreshed(globalCollateralRatio);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    // Used by pools when user redeems
    function poolBurnFrom(address _address, uint256 _amount) public onlyPools {
        super.burnFrom(_address, _amount);
        emit StableBurned(_address, msg.sender, _amount);
    }

    function poolBurn(address _address, uint256 _amount) public onlyPools {
        super.burn(_amount);
        emit StableBurned(_address, msg.sender, _amount);
    }

    function poolMint(address _address, uint256 _amount) public onlyPools {
        super._mint(_address, _amount);
        emit StableMinted(msg.sender, _address, _amount);
    }

    // Adds collateral addresses supported, such as tether and busd, must be ERC20 
    function addPool(address pool_address) public onlyOwner {
        require(pool_address != address(0), "Zero address detected");
        require(isStablePools[pool_address] == false, "Address already exists");
        isStablePools[pool_address] = true;
        poolAddress.push(pool_address);

        emit PoolAdded(pool_address);
    }

    // Remove a pool 
    function removePool(address pool_address) public onlyOwner {
        require(pool_address != address(0), "Zero address detected");
        require(isStablePools[pool_address] == true, "Address nonexistant");

        // Delete from the mapping
        delete isStablePools[pool_address];

        // 'Delete' from the array by setting the address to 0x0
        for (uint i = 0; i < poolAddress.length; i++) {
            if (poolAddress[i] == pool_address) {
                poolAddress[i] = address(0);
                // This will leave a null in the array and keep the indices the same
                break;
            }
        }
        emit PoolRemoved(pool_address);
    }

    function setRedemptionFee(uint256 red_fee) public onlyOwner {
        redemptionFee = red_fee;
        emit RedemptionFeeSet(red_fee);
    }

    function setMintingFee(uint256 min_fee) public onlyOwner {
        mintingFee = min_fee;
        emit MintingFeeSet(min_fee);
    }

    function setStableStep(uint256 _new_step) public onlyOwner {
        stableStep = _new_step;
        emit StableStepSet(_new_step);
    }

    function setPriceTarget(uint256 _new_price_target) public onlyOwner {
        priceTarget = _new_price_target;
        emit PriceTargetSet(_new_price_target);
    }

    function setRefreshCooldown(uint256 _new_cooldown) public onlyOwner {
        refreshCooldown = _new_cooldown;
        emit RefreshCooldownSet(_new_cooldown);
    }

    function setStockAddress(address _fxs_address) public onlyOwner {
        require(_fxs_address != address(0), "Zero address detected");
        stockAddress = _fxs_address;
        emit StockAddressSet(_fxs_address);
    }

    function setETHUSDOracle(address _eth_usd_consumer_address) public onlyOwner {
        require(_eth_usd_consumer_address != address(0), "Zero address detected");
        ethUsdConsumerAddress = _eth_usd_consumer_address;
        ethUsdPricer = ChainlinkETHUSDPriceConsumer(ethUsdConsumerAddress);
        ethUsdPricerDecimals = ethUsdPricer.getDecimals();
        emit ETHUSDOracleSet(_eth_usd_consumer_address);
    }

    function setPriceBand(uint256 _price_band) external onlyOwner {
        priceBand = _price_band;
        emit PriceBandSet(_price_band);
    }


    function setStableEthOracle(address _frax_oracle_addr, address _weth_address) public onlyOwner {
        require((_frax_oracle_addr != address(0)) && (_weth_address != address(0)), "Zero address detected");
        stableEthOracleAddress = _frax_oracle_addr;
        stableEthOracle = UniswapPairOracle(_frax_oracle_addr);
        weth = _weth_address;

        emit StableETHOracleSet(_frax_oracle_addr, _weth_address);
    }


    function setStockEthOracle(address _fxs_oracle_addr, address _weth_address) public onlyOwner {
        require((_fxs_oracle_addr != address(0)) && (_weth_address != address(0)), "Zero address detected");

        stockEthOracleAddress = _fxs_oracle_addr;
        stockEthOracle = UniswapPairOracle(_fxs_oracle_addr);
        weth = _weth_address;

        emit StockEthOracleSet(_fxs_oracle_addr, _weth_address);
    }


}
