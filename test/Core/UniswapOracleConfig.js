const {ethers} = require('hardhat');
const {GetMap} = require("../Factory/StableAndMockFactory");
const {ZEROADDRESS} = require('../Lib/Address');
const {BigNumber} = require('ethers');

const SetTimeLock = async (userAddress, timeLockDuration = 259200) => {
    if (0 >= timeLockDuration) {
        throw "Please input right time!";
    }
    const Timelock = await ethers.getContractFactory("Timelock");
    return await Timelock.deploy(userAddress.address, BigNumber.from(timeLockDuration));
}

const SetCollatETHOracle = async (stableCoinPool, setConfig, ethAddress) => {
    await stableCoinPool.setCollatETHOracle(setConfig.address, ethAddress.address);
}

const SetStableEthOracle = async (tokenObject, setConfig, ethAddress) => {
    await tokenObject.setStableEthOracle(setConfig.address, ethAddress.address);
}

const SetStockEthOracle = async (tokenObject, setConfig, ethAddress) => {
    await tokenObject.setStockEthOracle(setConfig.address, ethAddress.address);
}

const SetUniswapOracle = async (stableCoinPool, factory, coinPairs, weth, user, timeLock) => {
    let GraphicMap = await GetMap();
    let uniswapOracle;

    const UniswapPairOracle = await ethers.getContractFactory("UniswapPairOracle");
    uniswapOracle = await UniswapPairOracle.deploy(
        factory.address,
        coinPairs.address,
        weth.address,
        user.address,
        timeLock.address
    );

    switch (coinPairs.address) {
        case GraphicMap.get("USDC"):
            await SetCollatETHOracle(stableCoinPool, uniswapOracle, weth);
            break;
        case GraphicMap.get("RUSD"):
            await SetStableEthOracle(GraphicMap.get("RUSDOBJECT"), uniswapOracle, weth);
            expect(await GraphicMap.get("RUSDOBJECT").stableEthOracleAddress()).to.be.eq(uniswapOracle.address);
            break;
        case GraphicMap.get("TRA"):
            await SetStockEthOracle(GraphicMap.get("RUSDOBJECT"), uniswapOracle, weth);
            expect(await GraphicMap.get("RUSDOBJECT").stockEthOracleAddress()).to.be.eq(uniswapOracle.address);
            break;
        default:
            throw "Unknown token!";
    }
    return uniswapOracle;
}

module.exports = {
    SetTimeLock,
    SetUniswapOracle
}