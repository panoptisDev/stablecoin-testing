const CRVFactory = require('./mock/mockPool/factory.json');
const FactoryAbi = require('./mock/mockPool/factory_abi.json');
const Plain3Balances = require('./mock/mockPool/Plain3Balances.json');
const PoolAbi = require('./mock/mockPool/3pool_abi.json');
const Registry = require('./mock/mockPool/Registry.json');
const PoolRegistry = require('./mock/mockPool/PoolRegistry.json');
const Factory = require('../test/mock/PancakeFactory.json');
const Router = require('../test/mock/PancakeRouter.json');
const WETH = require('../test/mock/WETH9.json');
const {deployContract} = require('ethereum-waffle');
const {ethers} = require('hardhat');
const {expect} = require('chai');
const {BigNumber} = require('ethers');
const {toWei} = web3.utils;
const {time} = require('@openzeppelin/test-helpers');
const GAS = {gasLimit: "9550000"};

contract('AMOMinter', async function () {
    async function getUint8Array(len) {
        var buffer = new ArrayBuffer(len);
        var bufferArray = new Uint8Array(buffer);
        var length = bufferArray.length;
        for (var i = 0; i < length; i++) {
            bufferArray[i] = 0;
        }

        return bufferArray;
    }

    beforeEach(async function () {
        [owner, dev, addr1] = await ethers.getSigners();
        zeroAddr = "0x0000000000000000000000000000000000000000";
        const TestOracle = await ethers.getContractFactory('TestOracle');
        oracle = await TestOracle.deploy();

        weth = await deployContract(owner, {
            bytecode: WETH.bytecode,
            abi: WETH.abi,
        });

        await weth.deposit({value: toWei('10')});

        factory = await deployContract(owner, {
            bytecode: Factory.bytecode,
            abi: Factory.abi
        }, [owner.address]);

        router = await deployContract(owner, {
            bytecode: Router.bytecode,
            abi: Router.abi
        }, [factory.address, weth.address]);
        const testOperatable = await ethers.getContractFactory('Operatable');
        operatable = await testOperatable.deploy();

        const FRAXShares = await ethers.getContractFactory('Stock');
        fxs = await FRAXShares.deploy(operatable.address, "fxs", "fxs", oracle.address);

        const FRAXStablecoin = await ethers.getContractFactory('RStablecoin');
        frax = await FRAXStablecoin.deploy(operatable.address, "frax", "frax");

        const MockToken = await ethers.getContractFactory("MockToken");
        usdc = await MockToken.deploy("usdc", "usdc", 18, toWei('10'));
        busd = await MockToken.deploy("busd", "busd", 18, toWei('10'));
        crv = await MockToken.deploy("crv", "crv", 18, toWei('10'));

        await usdc.mint(owner.address, toWei('1000000000000'));

        token0 = await MockToken.deploy("token0", "token0", 18, toWei('10'));
        token1 = await MockToken.deploy("token1", "token1", 18, toWei('10'));
        token2 = await MockToken.deploy("token2", "token2", 18, toWei('10'));
        token3 = await MockToken.deploy("token3", "token3", 18, toWei('10'));

        await token0.mint(owner.address, toWei("10000"));
        await token1.mint(owner.address, toWei("10000"));
        await token2.mint(owner.address, toWei("10000"));
        await token3.mint(owner.address, toWei("10000"));

        await token0.mint(dev.address, toWei("10"));
        await token1.mint(dev.address, toWei("10"));
        await token2.mint(dev.address, toWei("10"));

        const Timelock = await ethers.getContractFactory('Timelock');
        timelock = await Timelock.deploy(owner.address, "259200");

        await fxs.setFraxAddress(frax.address);
        await frax.setFXSAddress(fxs.address);

        const FraxPoolLibrary = await ethers.getContractFactory('PoolLibrary')
        fraxPoolLibrary = await FraxPoolLibrary.deploy();

        const Pool_USDC = await ethers.getContractFactory('Pool_USDC', {
            libraries: {
                PoolLibrary: fraxPoolLibrary.address,
            },
        });
        usdcPool = await Pool_USDC.deploy(operatable.address, frax.address, fxs.address, usdc.address, toWei('10000000000'));
        expect(await usdcPool.USDC_address()).to.be.eq(usdc.address);

        // =========
        await frax.addPool(usdcPool.address);

        await fxs.addPool(owner.address);


        plain3Balances = await deployContract(owner, {
            bytecode: Plain3Balances.bytecode,
            abi: PoolAbi.abi
        })

        registry = await deployContract(owner, {
            bytecode: Registry.bytecode,
            abi: Registry.abi
        }, [owner.address]);

        poolRegistry = await deployContract(owner, {
            bytecode: PoolRegistry.bytecode,
            abi: PoolRegistry.abi
        }, [registry.address, zeroAddr]);


        await registry.set_address(0, poolRegistry.address);

        crvFactory = await deployContract(owner, {
            bytecode: CRVFactory.bytecode,
            abi: FactoryAbi.abi,
        }, [owner.address, registry.address])

        await crvFactory.set_plain_implementations(3,
            [
                plain3Balances.address,
                zeroAddr,
                zeroAddr,
                zeroAddr,
                zeroAddr,
                zeroAddr,
                zeroAddr,
                zeroAddr,
                zeroAddr,
                zeroAddr])


        // create  token0 token1 token2
        await crvFactory.deploy_plain_pool(
            "3pool",
            "3pool",
            [token0.address, frax.address, token2.address, zeroAddr],
            "2000",
            "4000000", 0, 0, GAS);

        poolAddress = await crvFactory.pool_list(0, GAS);

        pool = await plain3Balances.attach(poolAddress);

        await token0.approve(pool.address, toWei("10000"))
        await frax.approve(pool.address, toWei("10000"))
        await token2.approve(pool.address, toWei("10000"))

        await pool.add_liquidity([toWei('100'), toWei('100'), toWei('100')], 0, GAS)

        // ETHOracle
        const MockChainLink = await ethers.getContractFactory("MockChainLink");
        mockChainLink = await MockChainLink.deploy();
        const ChainlinkETHUSDPriceConsumer = await ethers.getContractFactory("ChainlinkETHUSDPriceConsumer");
        chainlinkETHUSDPriceConsumer = await ChainlinkETHUSDPriceConsumer.deploy(mockChainLink.address);
        await frax.setETHUSDOracle(chainlinkETHUSDPriceConsumer.address);
        /** attention */

        await factory.createPair(usdc.address, weth.address);
        pairAddr = await factory.getPair(usdc.address, weth.address);

        await factory.createPair(frax.address, weth.address);
        rusd_weth_Addr = await factory.getPair(frax.address, weth.address);
        await factory.createPair(fxs.address, weth.address);

        await usdc.approve(router.address, toWei('1000'));
        await weth.approve(router.address, toWei('10000'));

        await router.addLiquidity(
            usdc.address,
            weth.address,
           toWei('1'),
            toWei('1'),
            0,
            0,
            owner.address,
            Math.round(new Date() / 1000 + 1000)
        );

        await frax.approve(router.address, toWei('1000'));

        await router.addLiquidity(
            frax.address,
            weth.address,
            toWei('1'),
            toWei('1'),
            0,
            0,
            owner.address,
            Math.round(new Date() / 1000 + 1000)
        );

        await fxs.approve(router.address, toWei('1000'));
        await router.addLiquidity(
            fxs.address,
            weth.address,
            toWei('1'),
            toWei('1'),
            0,
            0,
            owner.address,
            Math.round(new Date() / 1000 + 1000)
        );

        const UniswapPairOracle = await ethers.getContractFactory("UniswapPairOracle");
        usdc_uniswapOracle = await UniswapPairOracle.deploy(factory.address, usdc.address, weth.address, owner.address, timelock.address);
        await usdcPool.setCollatETHOracle(usdc_uniswapOracle.address, weth.address);

        frax_uniswapOracle = await UniswapPairOracle.deploy(factory.address, frax.address, weth.address, owner.address, timelock.address);
        await frax.setFRAXEthOracle(frax_uniswapOracle.address, weth.address);
        expect(await frax.fraxEthOracleAddress()).to.be.eq(frax_uniswapOracle.address);

        fxs_uniswapOracle = await UniswapPairOracle.deploy(factory.address, fxs.address, weth.address, owner.address, timelock.address);
        await frax.setFXSEthOracle(fxs_uniswapOracle.address, weth.address);
        expect(await frax.fxsEthOracleAddress()).to.be.eq(fxs_uniswapOracle.address);

        // const AMOMinter = await ethers.getContractFactory('AMOMinter');
        // amoMinter = await AMOMinter.deploy(
        //     operatable.address,
        //     owner.address,
        //     frax.address,
        //     fxs.address,
        //     usdc.address,
        //     usdcPool.address
        // );
        //
        // const ExchangeAMO = await ethers.getContractFactory('ExchangeAMO');
        // exchangeAMO = await ExchangeAMO.deploy(
        //     operatable.address,
        //     amoMinter.address,
        //     frax.address,
        //     usdc.address,
        //     pool.address,
        //     frax.address
        // );
        //await frax.addPool(exchangeAMO.address)

        // await fxs.mint(exchangeAMO.address, toWei("100000"));
        // await token0.approve(exchangeAMO.address, toWei("100000000"));
        // await token0.mint(exchangeAMO.address, toWei("100000"));
        //
        // await amoMinter.addAMO(exchangeAMO.address, true);
        //
        // await fxs.addPool(amoMinter.address);
        // //  await frax.addPool(amoMinter.address);
        //
        // await usdcPool.addAMOMinter(amoMinter.address);

        // const FraxBond = await ethers.getContractFactory("Bond");
        // fxb = await FraxBond.deploy(operatable.address, "tempName", "tempSymbol");
        //
        // const FraxBondIssuer = await ethers.getContractFactory("BondIssuer");
        // fraxBondIssuer = await FraxBondIssuer.deploy(operatable.address, frax.address, fxb.address);

        //   await frax.addPool(fraxBondIssuer.address);

        // Approve
        // await frax.approve(fraxBondIssuer.address, toWei("1000"));
        //
        // await factory.createPair(fxs.address, fxb.address);
        //
        // await fxb.addIssuer(owner.address);
        // await fxb.issuer_mint(owner.address, toWei("1000"));
        //
        // // Approve
        // await fxb.approve(router.address, toWei('1000'));
        //
        // await router.addLiquidity(
        //     fxs.address,
        //     fxb.address,
        //     toWei('1'),
        //     toWei('100'),
        //     0,
        //     0,
        //     owner.address,
        //     Math.round(new Date() / 1000 + 1000)
        // )

        // frax_uniswapOracle = await UniswapPairOracle.deploy(factory.address, frax.address, fxb.address, owner.address, timelock.address);
        // await frax.setFRAXEthOracle(frax_uniswapOracle.address, fxb.address);
        // expect(await frax.fraxEthOracleAddress()).to.be.eq(frax_uniswapOracle.address);
        // console.log("owner_price::\t" + await usdc.balanceOf(owner.address));
        // Set period
    });


    it('test oldPoolRedeem', async function () {
        let redeemPtionFee;
        let colPriceUsd;
        let globalCollateralRatio;
        let latestPrice;
        let amoMinterBalanceOfFrax;
        let fxsPrice;
        const REDEEM_FEE = 10000;

        // await mockChainLink.setAnswer(BigNumber.from(1e18));
      //  await mockChainLink.setAnswer(BigNumber.from("1000000000000000000"));
        // Set period
        await frax_uniswapOracle.setPeriod(1);
       // expect(await frax_uniswapOracle.canUpdate()).to.be.eq(true);
        // Set oracle
        await frax_uniswapOracle.update();
      //  console.log("frax_price:\t" + await frax.fraxPrice());

        // Set redeem fee
        // await usdcPool.setPoolParameters(0, 0, 0, 0, 0, REDEEM_FEE, 0);
        // redeemPtionFee = await usdcPool.redemption_fee();
        // console.log("redeem_fee:\t" + redeemPtionFee);
        // latestPrice = await chainlinkETHUSDPriceConsumer.getLatestPrice();
        // console.log(latestPrice);
        // expect(parseInt(latestPrice)).to.be.eq(1);

        // expect(await usdc_uniswapOracle.PERIOD()).to.be.eq(3600);
        // // Set period
        // await usdc_uniswapOracle.setPeriod(1);
        // expect(await usdc_uniswapOracle.PERIOD()).to.be.eq(1);
        // expect(await usdc_uniswapOracle.canUpdate()).to.be.eq(true);
        // // expect(await chainlinkETHUSDPriceConsumer.getLatestPrice()).to.be.eq(1);
        // // Update MockChainLink value -> test token so can call set function
        // // await mockChainLink.setAnswer(BigNumber.from(1e13));
        // // expect(await frax.ethUsdPrice()).to.be.eq(10);
        // // Get usdc price
        // await usdc_uniswapOracle.update();
        // colPriceUsd = await usdcPool.getCollateralPrice();
        // console.log("col_price_usd:\t" + colPriceUsd);
        // // expect(parseInt(colPriceUsd)).to.be.eq(10);
        // console.log("price_target:\t" + await frax.priceTarget());
        // console.log("price_band:\t" + await frax.priceBand());
        // console.log("frax_price:\t" + await frax.fraxPrice());
        // await frax.refreshCollateralRatio();
        // globalCollateralRatio = await frax.globalCollateralRatio();
        // console.log("global_collateral_ratio:\t" + globalCollateralRatio)
        // // expect(parseInt(globalCollateralRatio)).to.be.eq(1000000);
        //
        // // Pool balances
        // amoMinterBalanceOfFrax = await frax.balanceOf(amoMinter.address);
        // expect(parseInt(amoMinterBalanceOfFrax)).to.be.eq(0);

        // Usdc pool redeemFractionalFRAX function
        // fxsPrice = await frax.fxsPrice();
        // Set period
        // await fxs_uniswapOracle.setPeriod(1);
        // // Set oracle
        // await fxs_uniswapOracle.update();
        // fxsPrice = await frax.fxsPrice();
        // console.log(fxsPrice);

        // Find -> addPool
        // let count = await frax.fraxPoolAddressCount();
        // console.log("1\t" + await frax.ethUsdPrice());
        //
        // console.log("usd_price:\t" + await frax.ethUsdPrice());
        // expect(parseInt(await frax.fraxPoolAddressCount())).to.be.eq(1);
        // console.log("owner_collat:\t" + await usdc.balanceOf(owner.address));
        // // console.log("2\t" + await usdcPool.collatDollarBalance());
        //
        // // Mint usdc amount
        // console.log("global_collateral_value:\t" + await frax.globalCollateralValue());
        // console.log("1:\t" + await frax.totalSupply());
        //
        //
        // console.log("usdc_in_pool:",(await usdc.balanceOf(usdcPool.address)));
        // // expect(parseInt(await frax.balanceOf(amoMinter.address))).to.be.eq(parseInt(toWei('1')));
        // console.log("2");
        // await amoMinter.addAMO(owner.address, true);
        // await usdc.mint(amoMinter.address, toWei('1'));

        // Mint usdc for usdc pool and change oracle to change ratio
        // await mockChainLink.setAnswer(BigNumber.from(1e18));
        // await mockChainLink.setAnswer(BigNumber.from("1000000000000000000"));
        // // Set period
        // await frax_uniswapOracle.setPeriod(1);
        // expect(await frax_uniswapOracle.canUpdate()).to.be.eq(true);
        // // Set oracle
        // await frax_uniswapOracle.update();
        // console.log("init_frax_price:\t" + await frax.fraxPrice());
        // console.log("current_frax_ratio:\t" + await frax.globalCollateralRatio());
        // Refresh ratio
        // lessVlaue = await frax.priceTarget() - await frax.priceBand();
        // console.log(lessVlaue);
        // expect(parseInt(await frax.fraxPrice())).to.be.lt(parseInt(lessVlaue));
        // await frax.refreshCollateralRatio();
        // await router.addLiquidity(
        //     frax.address,
        //     weth.address,
        //     toWei('0.1'),
        //     toWei('1'),
        //     0,
        //     0,
        //     owner.address,
        //     Math.round(new Date() / 1000 + 1000)
        // );
        // // Set period
        // await frax_uniswapOracle.setPeriod(1);
        // expect(await frax_uniswapOracle.canUpdate()).to.be.eq(true);
        // // Set oracle
        // await frax_uniswapOracle.update();
        // console.log("frax_price:\t" + await frax.fraxPrice());
        // console.log("current_frax_ratio:\t" + await frax.globalCollateralRatio());
        // // Refresh ratio
        // lessVlaue = await frax.priceTarget() - await frax.priceBand();
        // console.log(lessVlaue);
        // await frax.refreshCollateralRatio();
        // await time.advanceBlockTo(parseInt(await time.latestBlock()) + 10);
        // console.log("current_frax_ratio:\t" + await frax.globalCollateralRatio());
        // console.log("usd_in_pair_add:\t" + parseInt(await frax.balanceOf(rusd_weth_Addr)));
        // pairArray = new Array(2);
        // pairArray[0] = frax.address;
        // pairArray[1] = weth.address;
        // // currentTime = await time.latestTime();
        // await frax.setPriceTarget(toWei('1'));
       // await frax.setPriceBand(1);
        // Swap
        // for (let i = 0; i < 10; i++) {
        //     targetArray = await router.swapExactTokensForTokens(
        //         toWei('0.001'),
        //         0,
        //         pairArray,
        //         owner.address,
        //         Math.round(new Date() / 1000 + 1000)
        //     );
        // }
        // console.log("price_target:\t" + await frax.priceTarget());
        // // Set period
        // await frax_uniswapOracle.setPeriod(1);
        // expect(await frax_uniswapOracle.canUpdate()).to.be.eq(true);
        // // Set oracle
        // await frax_uniswapOracle.update();
        // console.log("frax_price:\t" + await frax.fraxPrice());
        // console.log("usd_in_pair_add:\t" + await frax.balanceOf(rusd_weth_Addr));
        // console.log("current_frax_ratio:\t" + await frax.globalCollateralRatio());
        // await time.advanceBlockTo(parseInt(await time.latestBlock()) + 10);
        // await frax.setRefreshCooldown(1);
        // await setTimeout(()=>{
        //     // frax.setFraxStep(1);
        //     frax.refreshCollateralRatio();
        //     // console.log("current_frax_ratio:\t" + frax.globalCollateralRatio());
        // },2000);
        // Set frax step

        // await frax.setFraxStep(1);
        // await frax.setRefreshCooldown(1);
        // await frax.refreshCollateralRatio();
        // console.log("current_frax_ratio:\t" + await frax.globalCollateralRatio());
        //
        // console.log("unclaimed_pool_collateral:\t" + await usdcPool.unclaimedPoolCollateral());
        // console.log("collateral_token:\t" + await usdc.balanceOf(usdcPool.address));
        // console.log("pool_celling:\t" + await usdcPool.pool_ceiling());
        // await usdcPool.setPoolParameters(toWei('1'), 0, 0, 0, 0, 0, 0);
        // console.log("pool_celling:\t" + await usdcPool.pool_ceiling());
        // console.log("owner_usdc:\t" + await usdc.balanceOf(owner.address));

        console.log("usdc:"+await usdc.balanceOf(owner.address))
        await usdcPool.mint1t1FRAX(toWei("0.1"), 0);
        // console.log("usdc_pool_usdc_balance:\t" + await usdc.balanceOf(usdcPool.address));
        // expect(parseInt(await usdc.balanceOf(amoMinter.address))).to.be.eq(parseInt(toWei('1')));
        // console.log("current_frax_ratio:\t" + await frax.globalCollateralRatio());
        // await amoMinter.giveCollatToAMO(exchangeAMO.address, 1);
        // await amoMinter.receiveCollatFromAMO(100);
        // await amoMinter.oldPoolRedeem(1);
        // amoMinterBalanceOfFrax = await frax.balanceOf(amoMinter.address);
        // expect(parseInt(amoMinterBalanceOfFrax)).to.be.eq(100000);
    });


});