const {expectThrow} = require('../../helpers/expectThrow');
const {ethSendTransaction, ethGetBalance} = require('../../helpers/web3');
const etherToWei = require('../../helpers/etherToWei');

const getTokenBalance = require('../../helpers/getTokenBalance');
let getBalance;

const NotRealDigitalAssetV2 = artifacts.require('NotRealDigitalAssetV2');
const ERC20Mock = artifacts.require('ERC20Mock');
const ForceEther = artifacts.require('ForceEther');

const bnChai = require('bn-chai');
const toBN = require('../../helpers/toBN');

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(web3.utils.BN))
  .should();

contract('HasNoEther', function ([_, owner, anyone]) {
  const amount = web3.utils.toWei('1', 'ether');

  beforeEach(async () => {
    this.erc20 = await ERC20Mock.new('Token', 'MTKN', owner, 0, {from: owner});
    getBalance = getTokenBalance(this.erc20);
    this.hasNoEther = await NotRealDigitalAssetV2.new(this.erc20.address, {from: owner});
  });

  //it('should not accept ether in constructor', async () => {
  //  await expectThrow(NotRealDigitalAssetV2.new({value: amount}));
  //});

  it('should not accept ether', async () => {
    await expectThrow(
      ethSendTransaction({
        from: owner,
        to: this.hasNoEther.address,
        value: amount,
      }),
    );
  });

  it('should allow owner to reclaim ether', async () => {
    const startBalance = await ethGetBalance(this.hasNoEther.address);
    assert.equal(startBalance, 0);

    // Force ether into it
    const forceEther = await ForceEther.new({value: amount});
    await forceEther.destroyAndSend(this.hasNoEther.address);
    const forcedBalance = await ethGetBalance(this.hasNoEther.address);
    assert.equal(forcedBalance, amount);

    // Reclaim
    const ownerStartBalance = await ethGetBalance(owner);
    await this.hasNoEther.reclaimEther({from: owner});
    const ownerFinalBalance = await ethGetBalance(owner);
    const finalBalance = await ethGetBalance(this.hasNoEther.address);
    assert.equal(finalBalance, 0);

    toBN(ownerFinalBalance).gt(toBN(ownerStartBalance)).should.be.true;
  });

  it('should allow only owner to reclaim ether', async () => {
    // Force ether into it
    const forceEther = await ForceEther.new({value: amount});
    await forceEther.destroyAndSend(this.hasNoEther.address);
    const forcedBalance = await ethGetBalance(this.hasNoEther.address);
    assert.equal(forcedBalance, amount);

    // Reclaim
    await expectThrow(this.hasNoEther.reclaimEther({from: anyone}));
  });

  it('should allow owner to reclaim tokens', async () => {
    
    const startBalance = await getBalance(this.hasNoEther.address);
    assert.equal(startBalance, 0);

    const amount = etherToWei(9999);
    await this.erc20.mint(this.hasNoEther.address, amount, { from: owner })
    const balance = await getBalance(this.hasNoEther.address);
    balance.should.be.eq.BN(amount);

    // Reclaim
    const ownerStartBalance = await getBalance(owner);
    await this.hasNoEther.reclaimEther({from: owner});
    const ownerFinalBalance = await getBalance(owner);
    const finalBalance = await getBalance(this.hasNoEther.address);
    assert.equal(finalBalance, 0);

    toBN(ownerFinalBalance).gt(toBN(ownerStartBalance)).should.be.true;
  });

  it('should allow only owner to reclaim tokens', async () => {
    const amount = etherToWei(9999);
    await this.erc20.mint(this.hasNoEther.address, amount, { from: owner })
    const balance = await getBalance(this.hasNoEther.address);
    balance.should.be.eq.BN(amount);

    // Reclaim
    await expectThrow(this.hasNoEther.reclaimEther({from: anyone}));
  });
});
