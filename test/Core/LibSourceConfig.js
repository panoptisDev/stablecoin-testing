const {ethers} = require('hardhat');
const {deployContract} = require("ethereum-waffle");
const {ZEROADDRESS} = require("../Lib/Address");
const {
    CRVFACTORY,
    FACTORY,
    FACTORYABI,
    POOLABI,
    WETH,
    PLAIN3BALANCE,
    POOLREGISTRY,
    REGISTRY,
    ROUTER
} = require("../Lib/QuoteMockJson");

const Weth = async (ownerAddress) => {
    return await deployContract(ownerAddress, {
        bytecode: WETH.bytecode,
        abi: WETH.abi,
    });
}

const Factory = async (ownerAddress) => {
    return await deployContract(ownerAddress, {
        bytecode: FACTORY.bytecode,
        abi: FACTORY.abi
    }, [ownerAddress.address]);
}

const Router = async (ownerAddress, factory, eth) => {
    // Source: https://github.com/pancakeswap/pancake-smart-contracts/blob/master/projects/exchange-protocol/contracts/PancakeRouter.sol
    return await deployContract(ownerAddress, {
        bytecode: ROUTER.bytecode,
        abi: ROUTER.abi
    }, [factory.address, eth.address]);
}

const Registry = async (ownerAddress) => {
    return await deployContract(ownerAddress, {
        bytecode: REGISTRY.bytecode,
        abi: REGISTRY.abi
    }, [ownerAddress.address]);
}

const PoolRegistry = async (ownerAddress, registry) => {
    return await deployContract(ownerAddress, {
        bytecode: POOLREGISTRY.bytecode,
        abi: POOLREGISTRY.abi
    }, [registry.address, ZEROADDRESS]);
}

const CRVFactory = async (ownerAddress, registry) => {
    return await deployContract(owner, {
        bytecode: CRVFACTORY.bytecode,
        abi: FACTORYABI.abi,
    }, [ownerAddress.address, registry.address]);
}

const Plain3Balances = async (ownerAddress) => {
    return await deployContract(ownerAddress, {
        bytecode: PLAIN3BALANCE.bytecode,
        abi: POOLABI.abi
    });
}

const SetPlainImplementations = async (crvFactory, coinInPoolNumber, poolArray = []) => {
    let factoryArray = new Array();
    let pool;

    if (0 === poolArray.length) {
        throw "Error, Must add a 3pool!";
    }

    for (let i = 0; i < 10; i++) {
        pool = poolArray[i];
        if (undefined === pool) {
            factoryArray.push(ZEROADDRESS);
        }else {
            factoryArray.push(pool.address);
        }
    }

    await crvFactory.set_plain_implementations(coinInPoolNumber, factoryArray);
}

const SetPoolByCrvFactory = async (crvFactory, tokenArray = [], amplification = 0, fee = 0, gas) => {
    let tempTokenArray = new Array();
    let tempToken;

    if (0 > fee || 0 > gas) {
        throw "More fee or gas!";
    }

    for (let i = 0; i < 4; i++) {
        tempToken = tokenArray[i];
        switch (tempToken) {
            case undefined:
                if (i === 3) {
                    tempTokenArray.push(ZEROADDRESS);
                }else {
                    throw "Exist invalid Token!";
                }
                break;
            case ZEROADDRESS:
                throw "Exist invalid Token!";
            default:
                tempTokenArray.push(tempToken.address);
                break;
        }
    }

    await crvFactory.deploy_plain_pool(
        "3pool",
        "3pool",
        tempTokenArray,
        "2000",
        "4000000",
        amplification,
        fee,
        gas
    );
}

module.exports = {
    Weth,
    Factory,
    Router,
    Router,
    Registry,
    PoolRegistry,
    CRVFactory,
    Plain3Balances,
    SetPlainImplementations,
    SetPoolByCrvFactory
}