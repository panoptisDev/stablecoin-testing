const {ethers} = require('hardhat');
const {TokenFactory} = require("../Factory/StableAndMockFactory");
const {ZEROADDRESS} = require("../Lib/Address");

const GetRusdAndTra = async () => {
    let resultArray;

    resultArray = await TokenFactory();

    return resultArray;
}

const SetRusdAndTraConfig = async (rusd, tra) => {
    if (ZEROADDRESS === rusd.address || ZEROADDRESS === tra.address) {
        throw "Invalid token!";
    }
    await tra.setStableAddress(rusd.address);
    await rusd.setStockAddress(tra.address);
}

const StableCoinPool = async (operater, rusd, tra, usdc, poolCelling) => {
    let stableCoinPool;

    if (0 >= poolCelling) {
        throw "Invalid pool celling!";
    }
    const FraxPoolLibrary = await ethers.getContractFactory("PoolLibrary");
    fraxPoolLibrary = await FraxPoolLibrary.deploy();
    const PoolUsdc = await ethers.getContractFactory("Pool_USDC", {
        libraries: {
            PoolLibrary: fraxPoolLibrary.address,
        },
    });
    stableCoinPool = await PoolUsdc.deploy(
        operater.address,
        rusd.address,
        tra.address,
        usdc.address,
        poolCelling
    );
    return stableCoinPool;
}

module.exports = {
    StableCoinPool,
    GetRusdAndTra,
    SetRusdAndTraConfig
}