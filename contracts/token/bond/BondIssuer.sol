// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.10;

import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "../../tools/AbstractPausable.sol";
import "../../math/Math.sol";
import "../Rusd.sol";
import "./Bond.sol";

contract BondIssuer is AbstractPausable {
    using SafeMath for uint256;

    uint256 public constant ONE_YEAR = 1 * 365 * 86400;
    uint256 public constant PRICE_PRECISION = 1e6;

    RStablecoin public stableCoin;
    Bond public bond;

    uint256 public lastInterestTime;
    uint256 public exchangeRate;
    uint256 public interestRate;
    uint256 public minInterestRate;
    uint256 public maxInterestRate;

    uint256 public maxBondOutstanding = 1000000e18;

    // Set fees, E6
    uint256 public issueFee = 100; // 0.01% initially
    uint256 public redemptionFee = 100; // 0.01% initially
    uint256 public fee;

    // Virtual balances
    uint256 public vBalStable;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _operatorMsg,
        address _stableAddress,
        address _BondAddress
    ) AbstractPausable(_operatorMsg) {
        stableCoin = RStablecoin(_stableAddress);
        bond = Bond(_BondAddress);
        minInterestRate = 1e16;
        maxInterestRate = 3e16;
        interestRate = 1e16;
        exchangeRate = 1e18;
        TransferHelper.safeApprove(address(stableCoin), address(this), type(uint256).max);
        TransferHelper.safeApprove(address(bond), address(bond), type(uint256).max);
    }

    function currentInterestRate() public view returns (uint256) {
        uint256 totalSupply = IERC20(bond).totalSupply();
        if (totalSupply <= maxBondOutstanding) {
            return interestRate;
        } else {
            return interestRate.mul(maxBondOutstanding).div(totalSupply);
        }
    }

    function collatDollarBalance() external pure returns (uint256) {
        return uint256(1e18);
    }

    function calInterest() public {
        if (block.timestamp > lastInterestTime) {
            uint256 timePast = block.timestamp.sub(lastInterestTime);
            uint256 interest = currentInterestRate().mul(timePast).div(ONE_YEAR);
            exchangeRate = exchangeRate.add(interest);
            lastInterestTime = block.timestamp;
        }
    }

    function mintBond(uint256 stableIn) external whenNotPaused returns (uint256 bondOut, uint256 stableFee) {
        calInterest();
        TransferHelper.safeTransferFrom(address(stableCoin), msg.sender, address(this), stableIn);

        stableFee = stableIn.mul(issueFee).div(PRICE_PRECISION);
        fee = fee.add(stableFee);

        uint256 amount = stableIn.sub(stableFee);
        stableCoin.poolBurn(msg.sender, amount);

        bondOut = stableIn.mul(1e18).div(exchangeRate);
        bond.issuer_mint(msg.sender, bondOut);
        vBalStable = vBalStable.add(stableIn);
        emit BondMint(msg.sender, stableIn, bondOut, stableFee);
    }

    function redeemBond(uint256 bondIn) external whenNotPaused returns (uint256 stableOut, uint256 stableFee) {
        calInterest();
        bond.burnFrom(msg.sender, bondIn);
        stableOut = bondIn.mul(exchangeRate).div(1e18);
        stableFee = stableOut.mul(redemptionFee).div(PRICE_PRECISION);
        fee = fee.add(stableFee);
        stableCoin.poolMint(address(this), stableOut);
        TransferHelper.safeTransfer(address(stableCoin), msg.sender, stableOut.sub(stableFee));
        vBalStable = vBalStable.sub(stableOut);
        emit BondRedeemed(msg.sender, bondIn, stableOut, stableFee);
    }

    function setMaxBondOutstanding(uint256 _max) external onlyOperator {
        maxBondOutstanding = _max;
    }

    function setRangeInterestRate(uint256 min, uint256 max) external onlyOperator {
        minInterestRate = min;
        maxInterestRate = max;
    }

    function setInterestRate(uint256 _interestRate) external onlyOperator {
        require(maxInterestRate >= _interestRate && _interestRate >= minInterestRate, "rate  in range");
        interestRate = _interestRate;
    }

    function setFees(uint256 _issue_fee, uint256 _redemption_fee) external onlyOperator {
        issueFee = _issue_fee;
        redemptionFee = _redemption_fee;
    }

    function claimFee() external onlyOperator {
        TransferHelper.safeTransfer(address(stableCoin), msg.sender, fee);
        fee = 0;
    }

    function recoverToken(address token, uint256 amount) external onlyOperator {
        ERC20(token).transfer(msg.sender, amount);
        emit Recovered(token, msg.sender, amount);
    }

    event Recovered(address token, address to, uint256 amount);

    // Track bond redeeming
    event BondRedeemed(address indexed from, uint256 bondAmount, uint256 stableOut, uint256 fee);
    event BondMint(address indexed from, uint256 stableAmount, uint256 bondOut, uint256 fee);
}
