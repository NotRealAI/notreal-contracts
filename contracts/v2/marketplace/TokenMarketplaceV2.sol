pragma solidity ^0.6.12;
// SPDX-License-Identifier: BUSL-1.1
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../../access/Whitelist.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../ReentrancyGuard.sol";
import "../../forwarder/NativeMetaTransaction.sol";

// ERC20
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

//import "hardhat/console.sol";

interface INRDAV2Methods {
  function ownerOf(uint256 _tokenId) external view returns (address _owner);

  function exists(uint256 _tokenId) external view returns (bool _exists);

  function purchaseDatesActive(uint256 _editionNumber) external view returns (bool _isActive);

  function purchaseDatesEnded(uint256 _editionNumber) external view returns (bool _ended);

  function purchaseDatesEdition(uint256 _editionNumber) external view returns (uint256 _startDate, uint256 _endDate);

  function updateEndDate(uint256 _editionNumber, uint256 _endDate) external;

  function editionOfTokenId(uint256 _tokenId) external view returns (uint256 tokenId);

  function artistCommission(uint256 _editionNumber) external view returns (address _artistAccount, uint256 _artistCommission);

  function editionOptionalCommission(uint256 _tokenId) external view returns (uint256 _rate, address _recipient);

  function safeTransferFrom(address _from, address _to, uint256 _tokenId) external;

}

// Based on ITokenMarketplace.sol
contract TokenMarketplaceV2 is 
Whitelist, 
Pausable, 
ReentrancyGuard,
NativeMetaTransaction("TokenMarketplaceV2")
{

  function _msgSender()
  internal
  view
  override(Context, NativeMetaTransaction)
  returns (address payable sender) {
    return NativeMetaTransaction._msgSender();
  }


  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  event UpdatePlatformPercentageFee(uint256 _oldPercentage, uint256 _newPercentage);
  event UpdateRoyaltyPercentageFee(uint256 _oldPercentage, uint256 _newPercentage);
  event UpdateMinterRoyaltyPercentageFee(uint256 _oldPercentage, uint256 _newPercentage);
  event UpdateMinBidAmount(uint256 minBidAmount);
  event UpdateOvertime(uint256 overtime, uint256 overtimeIncr);
  event UpdateCharityRoyaltyPercentage(uint256 _oldPercentage, uint256 _newPercentage);
  event UpdateCharityMintPercentage(uint256 _oldPercentage, uint256 _newPercentage);

  event TokenListed(
    uint256 indexed _tokenId,
    address indexed _seller,
    uint256 _price
  );

  event TokenDeListed(
    uint256 indexed _tokenId
  );

  event TokenPurchased(
    uint256 indexed _tokenId,
    address indexed _buyer,
    address indexed _seller,
    uint256 _price
  );

  event TokenGiven(
    uint256 indexed _tokenId,
    address indexed _buyer,
    address indexed _seller
  );

  event BidPlaced(
    uint256 indexed _tokenId,
    address indexed _currentOwner,
    address indexed _bidder,
    uint256 _amount
  );

  event BidWithdrawn(
    uint256 indexed _tokenId,
    address indexed _bidder
  );

  event BidAccepted(
    uint256 indexed _tokenId,
    address indexed _currentOwner,
    address indexed _bidder,
    uint256 _amount
  );

  event BidRejected(
    uint256 indexed _tokenId,
    address indexed _currentOwner,
    address indexed _bidder,
    uint256 _amount
  );

  event AuctionEnabled(
    uint256 indexed _tokenId,
    address indexed _auctioneer
  );

  event AuctionDisabled(
    uint256 indexed _tokenId,
    address indexed _auctioneer
  );

  event ListingEnabled(
    uint256 indexed _tokenId
  );

  event ListingDisabled(
    uint256 indexed _tokenId
  );

  struct Offer {
    address bidder;
    uint256 offer;
  }

  struct Listing {
    uint256 price;
    address seller;
  }

  // Min increase in bid/list amount
  uint256 public minBidAmount = 0.04 ether;

  // Interface into the NRDA world
  INRDAV2Methods public nrdaAddress;

  // NR account which can receive commission
  address public nrCommissionAccount;


  // Accepted ERC20 token
  IERC20 public acceptedToken;

  // These are in 1/1000ths
  uint256 public artistRoyaltyPercentage = 1;
  uint256 public platformFeePercentage   = 0;
  uint256 public minterRoyaltyPercentage = 20;


  // charity account
  address public charityAccount;
  uint256 public charityMintPercentage = 0;
  uint256 public charityRoyaltyPercentage = 0;

  uint256 public overtime = 300; // seconds
  uint256 public overtimeIncr = 5; // pct


  // Token ID to Offer mapping
  mapping(uint256 => Offer) public offers;

  // Token ID to Listing
  mapping(uint256 => Listing) public listings;

  // Edition ID to minter
  mapping(uint256 => address) public minters;

  // Explicitly disable sales for specific tokens
  mapping(uint256 => bool) public disabledTokens;

  // Explicitly disable listings for specific tokens
  mapping(uint256 => bool) public disabledListings;

  ///////////////
  // Modifiers //
  ///////////////

  modifier onlyWhenOfferOwner(uint256 _tokenId) {
    require(offers[_tokenId].bidder == _msgSender(), "Not offer maker");
    _;
  }

  modifier onlyWhenTokenExists(uint256 _tokenId) {
    require(nrdaAddress.exists(_tokenId), "Token does not exist");
    _;
  }

  modifier onlyWhenBidOverMinAmount(uint256 _tokenId, uint256 _msgValue) {
    require(_msgValue >= offers[_tokenId].offer.add(minBidAmount), "Offer not enough");
    _;
  }

  modifier onlyWhenTokenAuctionEnabled(uint256 _tokenId) {
    require(!disabledTokens[_tokenId], "Token not enabled for offers");
    _;
  }

  // Minting period means 1) Artist owns the token 2) Time is between token start/end dates
  modifier onlyDuringMintWindow(uint256 _tokenId) {
    uint256 editionNumber = nrdaAddress.editionOfTokenId(_tokenId);
    (address artistAccount, uint256 artistCommissionRate) = nrdaAddress.artistCommission(editionNumber);
    bool artistIsOwner = nrdaAddress.ownerOf(_tokenId) == artistAccount;
    require(!artistIsOwner || nrdaAddress.purchaseDatesActive(editionNumber), "Token owned by artist outside of minting window");
    _;
  }

  /////////////////
  // Constructor //
  /////////////////

  // Set the caller as the default NR account
  constructor(INRDAV2Methods _nrdaAddress, address _nrCommissionAccount, IERC20 _acceptedToken) public {
    nrdaAddress = _nrdaAddress;
    nrCommissionAccount = _nrCommissionAccount;
    // Nr commission account not used at the moment, 
    // but charity account is for future proofing and also differentiating 
    // mint purchase percent from royalty percent
    charityAccount = _nrCommissionAccount;
    acceptedToken = _acceptedToken;
    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    super.addAddressToWhitelist(_msgSender());
  }

  //////////////////////////
  // User Bidding Actions //
  //////////////////////////

  function placeBid(uint256 _tokenId, uint256 _msgValue)
  public
  whenNotPaused
  nonReentrant
  onlyWhenTokenExists(_tokenId)
  onlyWhenTokenAuctionEnabled(_tokenId)
  onlyDuringMintWindow(_tokenId)
  {

    require(_msgValue >= offers[_tokenId].offer.add(minBidAmount), "Offer not enough");

    overtimeBid(_tokenId, _msgValue);

    // require(!isContract(_msgSender()), "Unable to place a bid as a contract");
    acceptedToken.safeTransferFrom(_msgSender(), address(this), _msgValue);
    _refundHighestBidder(_tokenId);

    offers[_tokenId] = Offer({bidder : _msgSender(), offer : _msgValue});

    address currentOwner = nrdaAddress.ownerOf(_tokenId);

    emit BidPlaced(_tokenId, currentOwner, _msgSender(), _msgValue);
  }

  function overtimeBid(uint256 _tokenId, uint256 _msgValue)
  internal
  {
    uint256 editionNumber = nrdaAddress.editionOfTokenId(_tokenId);
    (uint256 startDate, uint256 endDate) = nrdaAddress.purchaseDatesEdition(editionNumber);
    if(endDate > block.timestamp && endDate.sub(block.timestamp) < overtime) {
      require(_msgValue >= offers[_tokenId].offer.div(100).mul(100 + overtimeIncr), "Overtime offer % threshold not met");
      nrdaAddress.updateEndDate(editionNumber, endDate + overtime.sub(endDate.sub(block.timestamp)));
    }
  }


  //// Allowing withdraw could create an exploit
  //function withdrawBid(uint256 _tokenId)
  //public
  //whenNotPaused
  //nonReentrant
  //onlyWhenTokenExists(_tokenId)
  //onlyWhenOfferOwner(_tokenId)
  //{
  //  _refundHighestBidder(_tokenId);
  //  emit BidWithdrawn(_tokenId, _msgSender());
  //}

  function rejectBid(uint256 _tokenId)
  public
  whenNotPaused
  nonReentrant
  {
    address currentOwner = nrdaAddress.ownerOf(_tokenId);
    require(currentOwner == _msgSender(), "Not token owner");

    uint256 currentHighestBiddersAmount = offers[_tokenId].offer;
    require(currentHighestBiddersAmount > 0, "No offer open");

    address currentHighestBidder = offers[_tokenId].bidder;

    _refundHighestBidder(_tokenId);

    emit BidRejected(_tokenId, currentOwner, currentHighestBidder, currentHighestBiddersAmount);
  }

  function acceptBid(uint256 _tokenId, uint256 _acceptedAmount)
  public
  whenNotPaused
  nonReentrant
  {
    address currentOwner = nrdaAddress.ownerOf(_tokenId);

    // Get edition no.
    uint256 editionNumber = nrdaAddress.editionOfTokenId(_tokenId);

    (address artistAccount, uint256 artistCommissionRate) = nrdaAddress.artistCommission(editionNumber);

    bool mintPurchase = (currentOwner == artistAccount && nrdaAddress.purchaseDatesEnded(editionNumber));

    require(currentOwner == _msgSender() || mintPurchase, "Not eligible to accept bid");

    Offer storage offer = offers[_tokenId];

    uint256 winningOffer = offer.offer;

    // Check valid offer and offer not replaced whilst inflight
    require(winningOffer > 0 && _acceptedAmount >= winningOffer, "Offer amount not satisfied");

    address winningBidder = offer.bidder;

    delete offers[_tokenId];

    _handleFunds(editionNumber, winningOffer, currentOwner, mintPurchase);

    nrdaAddress.safeTransferFrom(currentOwner, winningBidder, _tokenId);

    // If this is a mint purchase, the minter receives royalties for life
    if (mintPurchase) {
      minters[editionNumber] = winningBidder;
    }

    emit BidAccepted(_tokenId, currentOwner, winningBidder, winningOffer);
  }

  function _refundHighestBidder(uint256 _tokenId) internal {
    // Get current highest bidder
    address currentHighestBidder = offers[_tokenId].bidder;

    if (currentHighestBidder != address(0)) {

      // Get current highest bid amount
      uint256 currentHighestBiddersAmount = offers[_tokenId].offer;

      if (currentHighestBiddersAmount > 0) {

        // Clear out highest bidder
        delete offers[_tokenId];

        // Refund it
        acceptedToken.safeTransfer(currentHighestBidder, currentHighestBiddersAmount);
        //payable(currentHighestBidder).transfer(currentHighestBiddersAmount);
      }
    }
  }

  //////////////////////////
  // User Listing Actions //
  //////////////////////////

  function listToken(uint256 _tokenId, uint256 _listingPrice)
  public
  whenNotPaused {
    require(!disabledListings[_tokenId], "Listing disabled");

    // Check ownership before listing
    address tokenOwner = nrdaAddress.ownerOf(_tokenId);
    require(tokenOwner == _msgSender(), "Not token owner");

    // Check price over min bid
    require(_listingPrice >= minBidAmount, "Listing price not enough");

    // List the token
    listings[_tokenId] = Listing({
    price : _listingPrice,
    seller : _msgSender()
    });

    emit TokenListed(_tokenId, _msgSender(), _listingPrice);
  }


  function giveToken(uint256 _tokenId, address _to)
  public
  whenNotPaused {
    require(!disabledListings[_tokenId], "Listing disabled");

    address tokenOwner = nrdaAddress.ownerOf(_tokenId);
    require(tokenOwner == _msgSender(), "Not token owner");

    uint256 editionNumber = nrdaAddress.editionOfTokenId(_tokenId);
    (address artistAccount, uint256 artistCommissionRate) = nrdaAddress.artistCommission(editionNumber);
    bool artistIsOwner = nrdaAddress.ownerOf(_tokenId) == artistAccount;
    require(artistIsOwner, "Not artist owner");

    require(_to != address(0), "Invalid address");
    minters[editionNumber] = _to;

    nrdaAddress.safeTransferFrom(_msgSender(), _to, _tokenId);

    emit TokenGiven(_tokenId, _to, _msgSender());
  }

  function delistToken(uint256 _tokenId)
  public
  whenNotPaused {

    // check listing found
    require(listings[_tokenId].seller != address(0), "No listing found");

    // check owner is _msgSender()
    require(nrdaAddress.ownerOf(_tokenId) == _msgSender(), "Only the current owner can delist");

    _delistToken(_tokenId);
  }

  function buyToken(uint256 _tokenId, uint256 _msgValue)
  public
  nonReentrant
  whenNotPaused {
    Listing storage listing = listings[_tokenId];

    // check token is listed
    require(listing.seller != address(0), "No listing found");

    // check current owner is the lister as it may have changed hands
    address currentOwner = nrdaAddress.ownerOf(_tokenId);
    require(listing.seller == currentOwner, "Listing not valid, token owner has changed");

    // check listing satisfied
    uint256 listingPrice = listing.price;
    require(_msgValue == listingPrice, "List price not satisfied");
    acceptedToken.safeTransferFrom(_msgSender(), address(this), _msgValue);

    // Get edition no.
    uint256 editionNumber = nrdaAddress.editionOfTokenId(_tokenId);

    // refund any open offers on it
    Offer storage offer = offers[_tokenId];
    _refundHighestBidder(_tokenId);

    // split funds
    _handleFunds(editionNumber, listingPrice, currentOwner, false);

    // transfer token to buyer
    nrdaAddress.safeTransferFrom(currentOwner, _msgSender(), _tokenId);

    // de-list the token
    _delistToken(_tokenId);

    // Fire confirmation event
    emit TokenPurchased(_tokenId, _msgSender(), currentOwner, listingPrice);
  }

  function _delistToken(uint256 _tokenId) private {
    delete listings[_tokenId];

    emit TokenDeListed(_tokenId);
  }

  ////////////////////
  // Funds handling //
  ////////////////////

  function _handleFunds(uint256 _editionNumber, uint256 _offer, address _currentOwner, bool _mintPurchase) internal {

    // Get existing artist commission
    (address artistAccount, uint256 artistCommissionRate) = nrdaAddress.artistCommission(_editionNumber);

    // Get existing optional commission
    (uint256 optionalCommissionRate, address optionalCommissionRecipient) = nrdaAddress.editionOptionalCommission(_editionNumber);

    address minter = minters[_editionNumber];
    if (minter == address(0)) {
      // Just redirect minter fee to owner if undefined
      minter = _currentOwner;
    }

    uint256 charityFee = _mintPurchase ? charityMintPercentage : charityRoyaltyPercentage;

    _splitFunds(artistAccount, artistCommissionRate, optionalCommissionRecipient, optionalCommissionRate, charityFee, minter, _offer, _currentOwner);
  }

  function _splitFunds(
    address _artistAccount,
    uint256 _artistCommissionRate,
    address _optionalCommissionRecipient,
    uint256 _optionalCommissionRate,
    uint256 _charityFee,
    address _minterAccount,
    uint256 _offer,
    address _currentOwner
  ) internal {



    // Work out total % of royalties to payout = creator royalties + NR commission
    uint256 totalCommissionPercentageToPay = platformFeePercentage.add(artistRoyaltyPercentage).add(minterRoyaltyPercentage).add(_charityFee);

    // Send current owner majority share of the offer
    uint256 totalToSendToOwner = _offer.sub(
      _offer.div(1000).mul(totalCommissionPercentageToPay)
    );


    acceptedToken.safeTransfer(_currentOwner, totalToSendToOwner);
    //payable(_currentOwner).transfer(totalToSendToOwner);

    uint256 charityCommission = _offer.div(1000).mul(_charityFee);
    acceptedToken.safeTransfer(charityAccount, charityCommission);

    // Send % to NR
    uint256 nrCommission = _offer.div(1000).mul(platformFeePercentage);
    acceptedToken.safeTransfer(nrCommissionAccount, nrCommission);
    //payable(nrCommissionAccount).transfer(nrCommission);

    // Send % to NR
    uint256 minterRoyalty = _offer.div(1000).mul(minterRoyaltyPercentage);
    acceptedToken.safeTransfer(_minterAccount, minterRoyalty);
    //payable(_minterAccount).transfer(minterRoyalty);

    // Send to seller minus royalties and commission
    uint256 remainingRoyalties = _offer.sub(nrCommission).sub(minterRoyalty).sub(totalToSendToOwner).sub(charityCommission);

    if (_optionalCommissionRecipient == address(0)) {
      // After NR and Seller - send the rest to the original artist
      acceptedToken.safeTransfer(_artistAccount, remainingRoyalties);
      //payable(_artistAccount).transfer(remainingRoyalties);
    } else {
      _handleOptionalSplits(_artistAccount, _artistCommissionRate, _optionalCommissionRecipient, _optionalCommissionRate, remainingRoyalties);
    }

  }

  function _handleOptionalSplits(
    address _artistAccount,
    uint256 _artistCommissionRate,
    address _optionalCommissionRecipient,
    uint256 _optionalCommissionRate,
    uint256 _remainingRoyalties
  ) internal {
    uint256 _totalCollaboratorsRate = _artistCommissionRate.add(_optionalCommissionRate);
    uint256 _scaledUpCommission = _artistCommissionRate.mul(10 ** 18);

    // work out % of royalties total to split e.g. 43 / 85 = 50.5882353%
    uint256 primaryArtistPercentage = _scaledUpCommission.div(_totalCollaboratorsRate);

    uint256 totalPrimaryRoyaltiesToArtist = _remainingRoyalties.mul(primaryArtistPercentage).div(10 ** 18);
    acceptedToken.safeTransfer(_artistAccount, totalPrimaryRoyaltiesToArtist);
    //payable(_artistAccount).transfer(totalPrimaryRoyaltiesToArtist);

    uint256 remainingRoyaltiesToCollaborator = _remainingRoyalties.sub(totalPrimaryRoyaltiesToArtist);
    acceptedToken.safeTransfer(_optionalCommissionRecipient, remainingRoyaltiesToCollaborator);
    //payable(_optionalCommissionRecipient).transfer(remainingRoyaltiesToCollaborator);
  }

  ///////////////////
  // Query Methods //
  ///////////////////

  function tokenOffer(uint256 _tokenId) external view returns (address _bidder, uint256 _offer, address _owner, bool _enabled, bool _paused) {
    Offer memory offer = offers[_tokenId];
    return (
    offer.bidder,
    offer.offer,
    nrdaAddress.ownerOf(_tokenId),
    !disabledTokens[_tokenId],
    paused()
    );
  }

  function determineSaleValues(uint256 _tokenId) external view returns (uint256 _sellerTotal, uint256 _platformFee, uint256 _royaltyFee) {
    Offer memory offer = offers[_tokenId];
    uint256 offerValue = offer.offer;
    uint256 fee = offerValue.div(1000).mul(platformFeePercentage);
    uint256 royalties = offerValue.div(1000).mul(artistRoyaltyPercentage);

    return (
    offer.offer.sub(fee).sub(royalties),
    fee,
    royalties
    );
  }

  function tokenListingDetails(uint256 _tokenId) external view returns (uint256 _price, address _lister, address _currentOwner) {
    Listing memory listing = listings[_tokenId];
    return (
    listing.price,
    listing.seller,
    nrdaAddress.ownerOf(_tokenId)
    );
  }

  function isContract(address account) internal view returns (bool) {
    // This method relies in extcodesize, which returns 0 for contracts in
    // construction, since the code is only stored at the end of the
    // constructor execution.
    uint256 size;
    // solhint-disable-next-line no-inline-assembly
    assembly {size := extcodesize(account)}
    return size > 0;
  }

  ///////////////////
  // Admin Actions //
  ///////////////////

  function disableAuction(uint256 _tokenId)
  public
  onlyIfWhitelisted(_msgSender())
  {
    _refundHighestBidder(_tokenId);

    disabledTokens[_tokenId] = true;

    emit AuctionDisabled(_tokenId, _msgSender());
  }

  function enableAuction(uint256 _tokenId)
  public
  onlyIfWhitelisted(_msgSender())
  {
    _refundHighestBidder(_tokenId);

    disabledTokens[_tokenId] = false;

    emit AuctionEnabled(_tokenId, _msgSender());
  }

  function disableListing(uint256 _tokenId)
  public
  onlyIfWhitelisted(_msgSender())
  {
    _delistToken(_tokenId);

    disabledListings[_tokenId] = true;

    emit ListingDisabled(_tokenId);
  }

  function enableListing(uint256 _tokenId)
  public
  onlyIfWhitelisted(_msgSender())
  {
    disabledListings[_tokenId] = false;

    emit ListingEnabled(_tokenId);
  }

  function setMinBidAmount(uint256 _minBidAmount) public onlyIfWhitelisted(_msgSender()) {
    minBidAmount = _minBidAmount;
    emit UpdateMinBidAmount(minBidAmount);
  }

  function setNrdavV2(INRDAV2Methods _nrdaAddress) public onlyIfWhitelisted(_msgSender()) {
    nrdaAddress = _nrdaAddress;
  }

  function setNrCommissionAccount(address _nrCommissionAccount) public onlyIfWhitelisted(_msgSender()) {
    require(_nrCommissionAccount != address(0), "Invalid address");
    nrCommissionAccount = _nrCommissionAccount;
  }

  function setCharityAccount(address _charityAccount) public onlyIfWhitelisted(_msgSender()) {
    require(_charityAccount != address(0), "Invalid address");
    charityAccount = _charityAccount;
  }

  function setCharityPercentage(uint256 _charityMintPercentage, uint256 _charityRoyaltyPercentage) public onlyIfWhitelisted(_msgSender()) {
    emit UpdateCharityMintPercentage(charityMintPercentage, _charityMintPercentage);
    emit UpdateCharityRoyaltyPercentage(charityRoyaltyPercentage, _charityRoyaltyPercentage);
    charityMintPercentage = _charityMintPercentage;
    charityRoyaltyPercentage = _charityRoyaltyPercentage;
  }

  function setArtistRoyaltyPercentage(uint256 _artistRoyaltyPercentage) public onlyIfWhitelisted(_msgSender()) {
    emit UpdateRoyaltyPercentageFee(artistRoyaltyPercentage, _artistRoyaltyPercentage);
    artistRoyaltyPercentage = _artistRoyaltyPercentage;
  }

  function setPlatformPercentage(uint256 _platformFeePercentage) public onlyIfWhitelisted(_msgSender()) {
    emit UpdatePlatformPercentageFee(platformFeePercentage, _platformFeePercentage);
    platformFeePercentage = _platformFeePercentage;
  }

  function setMinterRoyaltyPercentage(uint256 _minterRoyaltyPercentage) public onlyIfWhitelisted(_msgSender()) {
    emit UpdateMinterRoyaltyPercentageFee(minterRoyaltyPercentage, _minterRoyaltyPercentage);
    minterRoyaltyPercentage = _minterRoyaltyPercentage;
  }

  function setMinter(uint256 _editionNumber, address _minterAccount) public onlyIfWhitelisted(_msgSender()) {
    require(_minterAccount != address(0), "Invalid address");
    minters[_editionNumber] = _minterAccount;
  }

  function setOvertime(uint256 _overtime) public onlyIfWhitelisted(_msgSender()) {
    overtime = _overtime;
    emit UpdateOvertime(overtime, overtimeIncr);
  }

  function setOvertimeIncr(uint256 _overtimeIncr) public onlyIfWhitelisted(_msgSender()) {
    overtimeIncr = _overtimeIncr;
    emit UpdateOvertime(overtime, overtimeIncr);
  }

  function pause() public onlyOwner {
      _pause();
  }

  function unpause() public onlyOwner {
      _unpause();
  }

  function reclaimEther() external onlyOwner {
    payable(owner()).transfer(address(this).balance);
    acceptedToken.transfer(owner(), acceptedToken.balanceOf(address(this)));
  }

}
