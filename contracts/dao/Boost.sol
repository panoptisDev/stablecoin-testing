// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


import "../interface/IVeToken.sol";
import '../Uniswap/TransferHelper.sol';

interface IBaseV1Factory {
    function isPair(address) external view returns (bool);
}

interface IBaseV1Core {
    function claimFees() external returns (uint, uint);

    function tokens() external returns (address, address);
}

interface IBaseV1GaugeFactory {
    function createGauge(address, address, address) external returns (address);
}

interface IBaseV1BribeFactory {
    function createBribe() external returns (address);
}

interface IGauge {
    function notifyRewardAmount(address token, uint amount) external;

    function getReward(address account, address[] memory tokens) external;

    function claimFees() external returns (uint claimed0, uint claimed1);

    function left(address token) external view returns (uint);
}

interface IBribe {
    function _deposit(uint amount, uint tokenId) external;

    function _withdraw(uint amount, uint tokenId) external;

    function getRewardForOwner(uint tokenId, address[] memory tokens) external;
}

contract Boost is ReentrancyGuard {

    event GaugeCreated(address indexed gauge, address creator, address indexed bribe, address indexed pool);
    event Voted(address indexed voter, uint tokenId, int256 weight);
    event Abstained(uint tokenId, int256 weight);
    event Deposit(address indexed lp, address indexed gauge, uint tokenId, uint amount);
    event Withdraw(address indexed lp, address indexed gauge, uint tokenId, uint amount);
    event NotifyReward(address indexed sender, address indexed reward, uint amount);
    event DistributeReward(address indexed sender, address indexed gauge, uint amount);
    event Attach(address indexed owner, address indexed gauge, uint tokenId);
    event Detach(address indexed owner, address indexed gauge, uint tokenId);
    event Whitelisted(address indexed whitelister, address indexed token);

    address public immutable _ve; // the ve token that governs these contracts
    address public immutable factory; // the BaseV1Factory
    address internal immutable base;
    address public immutable gaugefactory;
    address public immutable bribefactory;
    uint internal constant DURATION = 7 days; // rewards are released over 7 days
    address public minter;

    uint public totalWeight; // total voting weight

    address[] public pools; // all pools viable for incentives
    mapping(address => address) public gauges; // pool => gauge
    mapping(address => address) public poolForGauge; // gauge => pool
    mapping(address => int256) public weights; // pool => weight
    mapping(uint => mapping(address => int256)) public votes; // nft => pool => votes
    mapping(uint => address[]) public poolVote; // nft => pools
    mapping(uint => uint) public usedWeights;  // nft => total voting weight of user
    mapping(address => bool) public isGauge;
    mapping(address => bool) public isWhitelisted;

    uint internal index;
    mapping(address => uint) internal supplyIndex;
    mapping(address => uint) public claimable;

    constructor(address __ve, address _factory, address _gauges, address _bribes) {
        _ve = __ve;
        factory = _factory;
        base = IVeToken(__ve).token();
        gaugefactory = _gauges;
        bribefactory = _bribes;
        minter = msg.sender;
    }

    function initialize(address[] memory _tokens, address _minter) external {
        require(msg.sender == minter);
        for (uint i = 0; i < _tokens.length; i++) {
            _whitelist(_tokens[i]);
        }
        minter = _minter;
    }

    function listing_fee() public view returns (uint) {
        return (IERC20(base).totalSupply() - IERC20(_ve).totalSupply()) / 200;
    }

    function reset(uint _tokenId) external {
        require(IVeToken(_ve).isApprovedOrOwner(msg.sender, _tokenId));
        _reset(_tokenId);
        IVeToken(_ve).abstain(_tokenId);
    }

    function _reset(uint _tokenId) internal {
        address[] storage _poolVote = poolVote[_tokenId];
        uint _poolVoteCnt = _poolVote.length;
        int256 _totalWeight = 0;

        for (uint i = 0; i < _poolVoteCnt; i ++) {
            address _pool = _poolVote[i];
            int256 _votes = votes[_tokenId][_pool];

            if (_votes != 0) {
                _updateFor(gauges[_pool]);
                weights[_pool] -= _votes;
                votes[_tokenId][_pool] -= _votes;
                if (_votes > 0) {
                    //                    IBribe(bribes[gauges[_pool]])._withdraw(uint256(_votes), _tokenId);
                    _totalWeight += _votes;
                } else {
                    _totalWeight -= _votes;
                }
                emit Abstained(_tokenId, _votes);
            }
        }
        totalWeight -= uint256(_totalWeight);
        usedWeights[_tokenId] = 0;
        delete poolVote[_tokenId];
    }

    function poke(uint _tokenId) external {
        address[] memory _poolVote = poolVote[_tokenId];
        uint _poolCnt = _poolVote.length;
        int256[] memory _weights = new int256[](_poolCnt);

        for (uint i = 0; i < _poolCnt; i ++) {
            _weights[i] = votes[_tokenId][_poolVote[i]];
        }

        _vote(_tokenId, _poolVote, _weights);
    }

    function _vote(uint _tokenId, address[] memory _poolVote, int256[] memory _weights) internal {
        _reset(_tokenId);
        uint _poolCnt = _poolVote.length;
        int256 _weight = int256(IVeToken(_ve).balanceOfNFT(_tokenId));
        int256 _totalVoteWeight = 0;
        int256 _totalWeight = 0;
        int256 _usedWeight = 0;

        for (uint i = 0; i < _poolCnt; i++) {
            _totalVoteWeight += _weights[i] > 0 ? _weights[i] : - _weights[i];
        }

        for (uint i = 0; i < _poolCnt; i++) {
            address _pool = _poolVote[i];
            address _gauge = gauges[_pool];

            if (isGauge[_gauge]) {
                int256 _poolWeight = _weights[i] * _weight / _totalVoteWeight;
                require(votes[_tokenId][_pool] == 0);
                require(_poolWeight != 0);
                _updateFor(_gauge);

                poolVote[_tokenId].push(_pool);

                weights[_pool] += _poolWeight;
                votes[_tokenId][_pool] += _poolWeight;
                if (_poolWeight > 0) {
                    //                    IBribe(bribes[_gauge])._deposit(uint256(_poolWeight), _tokenId);
                } else {
                    _poolWeight = - _poolWeight;
                }
                _usedWeight += _poolWeight;
                _totalWeight += _poolWeight;
                emit Voted(msg.sender, _tokenId, _poolWeight);
            }
        }
        if (_usedWeight > 0) IVeToken(_ve).voting(_tokenId);
        totalWeight += uint256(_totalWeight);
        usedWeights[_tokenId] = uint256(_usedWeight);
    }

    function vote(uint tokenId, address[] calldata _poolVote, int256[] calldata _weights) external {
        require(IVeToken(_ve).isApprovedOrOwner(msg.sender, tokenId));
        require(_poolVote.length == _weights.length);
        _vote(tokenId, _poolVote, _weights);
    }

    function whitelist(address _token, uint _tokenId) public {
        if (_tokenId > 0) {
            require(msg.sender == IVeToken(_ve).ownerOf(_tokenId));
            require(IVeToken(_ve).balanceOfNFT(_tokenId) > listing_fee());
        } else {
            TransferHelper.safeTransferFrom(base, msg.sender, minter, listing_fee());
        }

        _whitelist(_token);
    }

    function _whitelist(address _token) internal {
        require(!isWhitelisted[_token]);
        isWhitelisted[_token] = true;
        emit Whitelisted(msg.sender, _token);
    }

    function createGauge(address _pool) external returns (address) {
        require(gauges[_pool] == address(0x0), "exists");
        require(IBaseV1Factory(factory).isPair(_pool), "!_pool");
        (address tokenA, address tokenB) = IBaseV1Core(_pool).tokens();
        require(isWhitelisted[tokenA] && isWhitelisted[tokenB], "!whitelisted");
        address _bribe = IBaseV1BribeFactory(bribefactory).createBribe();
        address _gauge = IBaseV1GaugeFactory(gaugefactory).createGauge(_pool, _bribe, _ve);
        IERC20(base).approve(_gauge, type(uint).max);
        //        bribes[_gauge] = _bribe;
        gauges[_pool] = _gauge;
        poolForGauge[_gauge] = _pool;
        isGauge[_gauge] = true;
        _updateFor(_gauge);
        pools.push(_pool);
        emit GaugeCreated(_gauge, msg.sender, _bribe, _pool);
        return _gauge;
    }

    function attachTokenToGauge(uint tokenId, address account) external {
        require(isGauge[msg.sender]);
        if (tokenId > 0) IVeToken(_ve).attach(tokenId);
        emit Attach(account, msg.sender, tokenId);
    }

    function emitDeposit(uint tokenId, address account, uint amount) external {
        require(isGauge[msg.sender]);
        emit Deposit(account, msg.sender, tokenId, amount);
    }

    function detachTokenFromGauge(uint tokenId, address account) external {
        require(isGauge[msg.sender]);
        if (tokenId > 0) IVeToken(_ve).detach(tokenId);
        emit Detach(account, msg.sender, tokenId);
    }

    function emitWithdraw(uint tokenId, address account, uint amount) external {
        require(isGauge[msg.sender]);
        emit Withdraw(account, msg.sender, tokenId, amount);
    }

    function length() external view returns (uint) {
        return pools.length;
    }


    function notifyRewardAmount(uint amount) external {
        TransferHelper.safeTransferFrom(base, msg.sender, address(this), amount);
        // transfer the distro in
        uint256 _ratio = amount * 1e18 / totalWeight;
        // 1e18 adjustment is removed during claim
        if (_ratio > 0) {
            index += _ratio;
        }
        emit NotifyReward(msg.sender, base, amount);
    }

    function updateFor(address[] memory _gauges) external {
        for (uint i = 0; i < _gauges.length; i++) {
            _updateFor(_gauges[i]);
        }
    }

    function updateForRange(uint start, uint end) public {
        for (uint i = start; i < end; i++) {
            _updateFor(gauges[pools[i]]);
        }
    }

    function updateAll() external {
        updateForRange(0, pools.length);
    }

    function updateGauge(address _gauge) external {
        _updateFor(_gauge);
    }

    function _updateFor(address _gauge) internal {
        address _pool = poolForGauge[_gauge];
        int256 _supplied = weights[_pool];
        if (_supplied > 0) {
            uint _supplyIndex = supplyIndex[_gauge];
            uint _index = index;
            // get global index0 for accumulated distro
            supplyIndex[_gauge] = _index;
            // update _gauge current position to global position
            uint _delta = _index - _supplyIndex;
            // see if there is any difference that need to be accrued
            if (_delta > 0) {
                uint _share = uint(_supplied) * _delta / 1e18;
                // add accrued difference for each supplied token
                claimable[_gauge] += _share;
            }
        } else {
            supplyIndex[_gauge] = index;
            // new users are set to the default global state
        }
    }

    function claimRewards(address[] memory _gauges, address[][] memory _tokens) external {
        for (uint i = 0; i < _gauges.length; i++) {
            IGauge(_gauges[i]).getReward(msg.sender, _tokens[i]);
        }
    }


    function distribute(address _gauge) public nonReentrant {
        //todo minter token for gauge
        //        IMinter(minter).update_period();
        _updateFor(_gauge);
        uint _claimable = claimable[_gauge];
        if (_claimable > IGauge(_gauge).left(base) && _claimable / DURATION > 0) {
            claimable[_gauge] = 0;
            IGauge(_gauge).notifyRewardAmount(base, _claimable);
            emit DistributeReward(msg.sender, _gauge, _claimable);
        }
    }

    function distribute() external {
        distribute(0, pools.length);
    }

    function distribute(uint start, uint finish) public {
        for (uint x = start; x < finish; x++) {
            distribute(gauges[pools[x]]);
        }
    }

    function distribute(address[] memory _gauges) external {
        for (uint x = 0; x < _gauges.length; x++) {
            distribute(_gauges[x]);
        }
    }
}
