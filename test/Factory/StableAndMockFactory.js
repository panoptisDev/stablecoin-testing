const {ethers} = require('hardhat');
const {SetOracle, SetOperatable, SetRusd, SetTra, SetCheckPermission} = require("../Core/StableConfig");
const {SetMockToken, MintMockToken} = require("../Core/MockTokenConfig");
const {ZEROADDRESS} = require("../Lib/Address");

const GraphicTokenMap = new Map();

const GetMap = async () => {
    return GraphicTokenMap;
}

const TokenFactory = async () => {
    let resultArray = new Array();

    let oracle = await SetOracle();
    let operatable = await SetOperatable();
    let checkOpera = await SetCheckPermission(operatable);
    let rusd = await SetRusd(operatable);
    let tra = await SetTra(operatable, oracle);

    GraphicTokenMap.set("CHECKOPERA", checkOpera);
    GraphicTokenMap.set("RUSD", rusd);
    GraphicTokenMap.set("TRA", tra);

    resultArray.push(rusd, tra, operatable, checkOpera, oracle);

    return resultArray;
}

const MockTokenFactory = async (deployMockTokenNumber = 1, mintUser = [], mintNumber = toWei("1")) => {
    let user;
    let token;
    let temp;
    let resultArray = new Array();

    if (deployMockTokenNumber <= 0) {
        throw Error("Please input token what you need!");
    }

    for (let i = 0; i < deployMockTokenNumber; i++) {
        token = await SetMockToken();
        if (0 === mintUser.length) {
            throw Error("Please enter the user who wants to mint coins!");
        }
        for (let j = 0; j < mintUser.length; j++) {
            if ("object" === typeof mintUser[j] && undefined !== mintUser[j].address) {
                user = mintUser[j];
                await MintMockToken(token, user.address, mintNumber);
            } else {
                throw Error("Please checking user addresses!");
            }
        }
        resultArray.push(token);
    }

    temp = resultArray[0]; // First mock token defined to usdc
    GraphicTokenMap.set("USDC", temp);

    return resultArray;
}

module.exports = {
    TokenFactory,
    MockTokenFactory,
    GetMap
}
