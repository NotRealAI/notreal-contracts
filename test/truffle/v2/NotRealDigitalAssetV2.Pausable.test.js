const assertRevert = require('../../helpers/assertRevert');
const addEditionCreators = require('../../helpers/nrda');
const NotRealDigitalAssetV2 = artifacts.require('NotRealDigitalAssetV2');
const etherToWei = require('../../helpers/etherToWei');
const ERC20Mock = artifacts.require('ERC20Mock');

contract('Pausable', function (accounts) {
  const _owner = accounts[0];

  const account1 = accounts[1];

  const artistAccount = accounts[8];
  const artistShare = 76;
  const editionType = 1;
  const editionNumber1 = 100000;
  const editionData1 = web3.utils.asciiToHex("editionData1");
  const editionTokenUri1 = "edition1";
  const edition1Price = etherToWei(0.1);

  beforeEach(async () => {
    this.erc20 = await ERC20Mock.new('Token', 'MTKN', _owner, 0, {from:_owner});

    this.token = await NotRealDigitalAssetV2.new(this.erc20.address, {from: _owner});

    const accts = [_owner, account1, artistAccount];
    await Promise.all(accts.map(async acct => {
      await this.erc20.mint(acct, etherToWei(9999), { from: _owner })
    }))

    addEditionCreators(this.token);

    await this.token.createActiveEdition(editionNumber1, editionData1, editionType, 0, 0, artistAccount, artistShare, edition1Price, editionTokenUri1, 3, {from: _owner});
  });

  it('can perform normal process in non-pause', async () => {
    await this.erc20.approve(this.token.address, etherToWei(9999), {from: account1})
    await this.token.purchase(editionNumber1, edition1Price, {from: account1});
    let tokens = await this.token.tokensOf(account1);

    expect(tokens.map(e => e.toNumber())).to.deep.equal([editionNumber1 + 1]);
  });

  it('can not perform normal process in pause', async () => {
    await this.token.pause();
    await this.erc20.approve(this.token.address, etherToWei(9999), {from: account1})
    await assertRevert(this.token.purchase(editionNumber1, edition1Price, {from: account1}));
  });

  it('should resume allowing normal process after pause is over', async () => {
    await this.token.pause();
    await this.token.unpause();

    await this.erc20.approve(this.token.address, etherToWei(9999), {from: account1})
    await this.token.purchase(editionNumber1, edition1Price, {from: account1});
    let tokens = await this.token.tokensOf(account1);
    expect(tokens.map(e => e.toNumber())).to.deep.equal([editionNumber1 + 1]);
  });

});
