pragma solidity ^0.6.12;

// allows for multi-address access controls to different functions
//import "../access/AccessControlled.sol";

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ERC721
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721Pausable.sol";

// ERC20
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


// For safe maths operations
import "@openzeppelin/contracts/math/SafeMath.sol";

// Utils only
import "./StringsUtil.sol";
import "../forwarder/NativeMetaTransaction.sol";

// import "hardhat/console.sol";

/**
* @title NotRealDigitalAsset - V2
*
* http://www.notreal.ai/
*
* ERC721 compliant digital assets for real-world artwork.
*
* Base NFT Issuance Contract
*
* AMPLIFY ART.
*
*/
contract NotRealDigitalAssetV2 is
AccessControl,
Ownable,
ERC721Burnable,
ERC721Pausable,
NativeMetaTransaction("NotRealDigitalAssetV2")
{

  function _msgSender()
  internal
  view
  override(Context, NativeMetaTransaction)
  returns (address payable sender) {
    return NativeMetaTransaction._msgSender();
  }

  bytes32 public constant ROLE_NOT_REAL = keccak256('ROLE_NOT_REAL');
  bytes32 public constant ROLE_MINTER = keccak256('ROLE_MINTER');

  ///////////////
  // Modifiers //
  ///////////////

  modifier onlyAvailableEdition(uint256 _editionNumber) {
    _onlyAvailableEdition(_editionNumber);
    _;
  }

  modifier onlyActiveEdition(uint256 _editionNumber) {
    _onlyActiveEdition(_editionNumber);
    _;
  }

  modifier onlyRealEdition(uint256 _editionNumber) {
    _onlyRealEdition(_editionNumber);
    _;
  }

  modifier onlyValidTokenId(uint256 _tokenId) {
    _onlyValidTokenId(_tokenId);
    _;
  }

  modifier onlyPurchaseDuringWindow(uint256 _editionNumber) {
    _onlyPurchaseDuringWindow(_editionNumber);
    _;
  }

  function _onlyAvailableEdition(uint256 _editionNumber) internal view {
    require(editionNumberToEditionDetails[_editionNumber].totalSupply < editionNumberToEditionDetails[_editionNumber].totalAvailable);
  }

  function _onlyActiveEdition(uint256 _editionNumber) internal view {
    require(editionNumberToEditionDetails[_editionNumber].active);
  }

  function _onlyRealEdition(uint256 _editionNumber) internal view {
    require(editionNumberToEditionDetails[_editionNumber].editionNumber > 0);
  }

  function _onlyValidTokenId(uint256 _tokenId) internal view {
    require(_exists(_tokenId));
  }

  function _onlyPurchaseDuringWindow(uint256 _editionNumber) internal view {
    require(editionNumberToEditionDetails[_editionNumber].startDate <= block.timestamp);
    require(editionNumberToEditionDetails[_editionNumber].endDate >= block.timestamp);
  }

  modifier onlyIfNotReal() {
    _onlyIfNotReal();
    _;
  }

  modifier onlyIfMinter() {
    _onlyIfMinter();
    _;
  }

  function _onlyIfNotReal()  internal view {
    require(_msgSender() == owner() || hasRole(ROLE_NOT_REAL, _msgSender()));
  }

  function _onlyIfMinter() internal view {
    require(_msgSender() == owner() || hasRole(ROLE_NOT_REAL, _msgSender()) || hasRole(ROLE_MINTER, _msgSender()));
  }

  ////////////////////////////////////
  // Whitelist/RBCA Derived Methods //
  ////////////////////////////////////

  function addAddressToAccessControl(address _operator, bytes32 _role)
  public
  onlyIfNotReal
  {
    grantRole(_role, _operator);
  }

  function removeAddressFromAccessControl(address _operator, bytes32 _role)
  public
  onlyIfNotReal
  {
    revokeRole(_role, _operator);
  }

  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  ////////////
  // Events //
  ////////////

  // Emitted on purchases from within this contract
  event Purchase(
    uint256 indexed _tokenId,
    uint256 indexed _editionNumber,
    address indexed _buyer,
    uint256 _priceInWei
  );

  // Emitted on every mint
  event Minted(
    uint256 indexed _tokenId,
    uint256 indexed _editionNumber,
    address indexed _buyer
  );

  // Emitted on every edition created
  event EditionCreated(
    uint256 indexed _editionNumber,
    bytes32 indexed _editionData,
    uint256 indexed _editionType
  );

  ////////////////
  // Properties //
  ////////////////

  uint256 constant internal MAX_UINT32 = ~uint32(0);

  string public tokenBaseURI = "https://ipfs.infura.io/ipfs/";

  // simple counter to keep track of the highest edition number used
  uint256 public highestEditionNumber;

  // total wei been processed through the contract
  uint256 public totalPurchaseValueInWei;

  // number of assets minted of any type
  uint256 public totalNumberMinted;

  // number of assets available of any type
  uint256 public totalNumberAvailable;

  // the NR account which can receive commission
  address public nrCommissionAccount;

  // Accepted ERC20 token
  IERC20 public acceptedToken;

  // Optional commission split can be defined per edition
  mapping(uint256 => CommissionSplit) editionNumberToOptionalCommissionSplit;

  // Simple structure providing an optional commission split per edition purchase
  struct CommissionSplit {
    uint256 rate;
    address recipient;
  }

  // Object for edition details
  struct EditionDetails {
    // Identifiers
    uint256 editionNumber;    // the range e.g. 10000
    bytes32 editionData;      // some data about the edition
    uint256 editionType;      // e.g. 1 = NRDA V1, 2 = NRTA, 3 = Bespoke partnership, 4 = Deactivated
    // Config
    uint256 startDate;        // date when the edition goes on sale
    uint256 endDate;          // date when the edition is available until
    address artistAccount;    // artists account
    uint256 artistCommission; // base artists commission, could be overridden by external contracts
    uint256 priceInWei;       // base price for edition, could be overridden by external contracts
    string tokenURI;          // IPFS hash - see base URI
    bool active;              // Root control - on/off for the edition
    // Counters
    uint256 totalSupply;      // Total purchases or mints
    uint256 totalAvailable;   // Total number available to be purchased
  }

  // _editionNumber : EditionDetails
  mapping(uint256 => EditionDetails) internal editionNumberToEditionDetails;

  // _tokenId : _editionNumber
  mapping(uint256 => uint256) internal tokenIdToEditionNumber;

  // _editionNumber : [_tokenId, _tokenId]
  mapping(uint256 => uint256[]) internal editionNumberToTokenIds;
  mapping(uint256 => uint256) internal editionNumberToTokenIdIndex;

  // _artistAccount : [_editionNumber, _editionNumber]
  mapping(address => uint256[]) internal artistToEditionNumbers;
  mapping(uint256 => uint256) internal editionNumberToArtistIndex;

  // _editionType : [_editionNumber, _editionNumber]
  mapping(uint256 => uint256[]) internal editionTypeToEditionNumber;
  mapping(uint256 => uint256) internal editionNumberToTypeIndex;



  /*
   * Constructor
   */
  constructor (IERC20 _acceptedToken) public payable ERC721("NotRealDigitalAsset", "NRDA") {
    // set commission account to contract creator
    nrCommissionAccount = _msgSender();
    acceptedToken = _acceptedToken;
    _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    _setBaseURI(tokenBaseURI);
  }

  function pause() public onlyIfNotReal {
      _pause();
  }

  function unpause() public onlyIfNotReal {
      _unpause();
  }

  /**
   * @dev Private (NR only) method for minting editions
   * @dev Payment not needed for this method
   */
  function mint(address _to, uint256 _editionNumber)
  public
  onlyIfMinter
  onlyRealEdition(_editionNumber)
  onlyAvailableEdition(_editionNumber)
  returns (uint256) {
    // Construct next token ID e.g. 100000 + 1 = ID of 100001 (this first in the edition set)
    uint256 _tokenId = _nextTokenId(_editionNumber);

    // Create the token
    _mintToken(_to, _tokenId, _editionNumber, editionNumberToEditionDetails[_editionNumber].tokenURI);

    // Create the token
    return _tokenId;
  }

  /**
   * @dev Internal factory method for building editions
   */
  function createEdition(
    uint256 _editionNumber,
    bytes32 _editionData,
    uint256 _editionType,
    uint256 _startDate,
    uint256 _endDate,
    address _artistAccount,
    uint256 _artistCommission,
    uint256 _priceInWei,
    string memory _tokenURI,
    uint256 _totalAvailable,
    bool _active
  )
  public
  onlyIfNotReal
  returns (bool)
  {
    // Prevent missing edition number
    require(_editionNumber != 0);

    // Prevent edition number lower than last one used
    require(_editionNumber > highestEditionNumber);

    // Check previously edition plus total available is less than new edition number
    require(highestEditionNumber.add(editionNumberToEditionDetails[highestEditionNumber].totalAvailable) < _editionNumber);

    // Prevent missing types
    require(_editionType != 0);

    // Prevent missing token URI
    require(bytes(_tokenURI).length != 0);

    // Prevent empty artists address
    require(_artistAccount != address(0));

    // Prevent invalid commissions
    require(_artistCommission <= 100 && _artistCommission >= 0);

    // Prevent duplicate editions
    require(editionNumberToEditionDetails[_editionNumber].editionNumber == 0);

    // Default end date to max uint256
    uint256 endDate = _endDate;
    if (_endDate == 0) {
      endDate = MAX_UINT32;
    }

    editionNumberToEditionDetails[_editionNumber] = EditionDetails({
      editionNumber : _editionNumber,
      editionData : _editionData,
      editionType : _editionType,
      startDate : _startDate,
      endDate : endDate,
      artistAccount : _artistAccount,
      artistCommission : _artistCommission,
      priceInWei : _priceInWei,
      tokenURI : _tokenURI,
      totalSupply : 0, // default to all available
      totalAvailable : _totalAvailable,
      active : _active
      });

    // Add to total available count
    totalNumberAvailable = totalNumberAvailable.add(_totalAvailable);

    // Update mappings
    _updateArtistLookupData(_artistAccount, _editionNumber);
    _updateEditionTypeLookupData(_editionType, _editionNumber);

    emit EditionCreated(_editionNumber, _editionData, _editionType);

    // Update the edition pointer if needs be
    highestEditionNumber = _editionNumber;

    return true;
  }

  function _updateEditionTypeLookupData(uint256 _editionType, uint256 _editionNumber) internal {
    uint256 typeEditionIndex = editionTypeToEditionNumber[_editionType].length;
    editionTypeToEditionNumber[_editionType].push(_editionNumber);
    editionNumberToTypeIndex[_editionNumber] = typeEditionIndex;
  }

  function _updateArtistLookupData(address _artistAccount, uint256 _editionNumber) internal {
    uint256 artistEditionIndex = artistToEditionNumbers[_artistAccount].length;
    artistToEditionNumbers[_artistAccount].push(_editionNumber);
    editionNumberToArtistIndex[_editionNumber] = artistEditionIndex;
  }

  /**
   * @dev Public entry point for purchasing an edition
   * @dev Reverts if edition is invalid
   * @dev Reverts if payment not provided in full
   * @dev Reverts if edition is sold out
   * @dev Reverts if edition is not active or available
   */
  function purchase(uint256 _editionNumber, uint256 _msgValue)
  public
  payable
  returns (uint256) {
    return purchaseTo(_msgSender(), _editionNumber, _msgValue);
  }

  /**
   * @dev Public entry point for purchasing an edition on behalf of someone else
   * @dev Reverts if edition is invalid
   * @dev Reverts if payment not provided in full
   * @dev Reverts if edition is sold out
   * @dev Reverts if edition is not active or available
   */
  function purchaseTo(address _to, uint256 _editionNumber, uint256 _msgValue)
  public
  payable
  whenNotPaused
  onlyRealEdition(_editionNumber)
  onlyActiveEdition(_editionNumber)
  onlyAvailableEdition(_editionNumber)
  onlyPurchaseDuringWindow(_editionNumber)
  returns (uint256) {

    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    require(_msgValue >= _editionDetails.priceInWei);
    
    // Transfer token to this contract
    acceptedToken.safeTransferFrom(_msgSender(), address(this), _msgValue);

    // Construct next token ID e.g. 100000 + 1 = ID of 100001 (this first in the edition set)
    uint256 _tokenId = _nextTokenId(_editionNumber);

    // Create the token
    _mintToken(_to, _tokenId, _editionNumber, _editionDetails.tokenURI);

    // Splice funds and handle commissions
    _handleFunds(_editionNumber, _editionDetails.priceInWei, _editionDetails.artistAccount, _editionDetails.artistCommission, _msgValue);

    // Broadcast purchase
    emit Purchase(_tokenId, _editionNumber, _to, _msgValue);

    return _tokenId;
  }

  function _nextTokenId(uint256 _editionNumber) internal returns (uint256) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];

    // Bump number totalSupply
    _editionDetails.totalSupply = _editionDetails.totalSupply.add(1);

    // Construct next token ID e.g. 100000 + 1 = ID of 100001 (this first in the edition set)
    return _editionDetails.editionNumber.add(_editionDetails.totalSupply);
  }

  function _mintToken(address _to, uint256 _tokenId, uint256 _editionNumber, string memory _tokenURI) internal {

    // Mint new base token
    super._mint(_to, _tokenId);
    super._setTokenURI(_tokenId, _tokenURI);

    // Maintain mapping for tokenId to edition for lookup
    tokenIdToEditionNumber[_tokenId] = _editionNumber;

    // Get next insert position for edition to token Id mapping
    uint256 currentIndexOfTokenId = editionNumberToTokenIds[_editionNumber].length;

    // Maintain mapping of edition to token array for "edition minted tokens"
    editionNumberToTokenIds[_editionNumber].push(_tokenId);

    // Maintain a position index for the tokenId within the edition number mapping array, used for clean up token burn
    editionNumberToTokenIdIndex[_tokenId] = currentIndexOfTokenId;

    // Record sale volume
    totalNumberMinted = totalNumberMinted.add(1);

    // Emit minted event
    emit Minted(_tokenId, _editionNumber, _to);
  }

  function _handleFunds(uint256 _editionNumber, uint256 _priceInWei, address _artistAccount, uint256 _artistCommission, uint256 _msgValue) internal {

    // Extract the artists commission and send it
    uint256 artistPayment = _priceInWei.div(100).mul(_artistCommission);
    if (artistPayment > 0) {
      acceptedToken.safeTransfer(_artistAccount, artistPayment); 
      //payable(_artistAccount).transfer(artistPayment);
    }

    // Load any commission overrides
    CommissionSplit storage commission = editionNumberToOptionalCommissionSplit[_editionNumber];

    // Apply optional commission structure
    uint256 rateSplit = 0;
    if (commission.rate > 0) {
      rateSplit = _priceInWei.div(100).mul(commission.rate);
      acceptedToken.safeTransfer(commission.recipient, rateSplit); 
      //payable(commission.recipient).transfer(rateSplit);
    }

    // Send remaining eth to NR
    uint256 remainingCommission = _msgValue.sub(artistPayment).sub(rateSplit);
    acceptedToken.safeTransfer(nrCommissionAccount, remainingCommission); 
    //payable(nrCommissionAccount).transfer(remainingCommission);

    // Record wei sale value
    totalPurchaseValueInWei = totalPurchaseValueInWei.add(_msgValue);
  }

  /**
   * @dev Private (NR only) method for burning tokens which have been created incorrectly
   */
  function burn(uint256 _tokenId) public override onlyIfNotReal {

    // Clear from parents
    super._burn(_tokenId);

    // Get hold of the edition for cleanup
    uint256 _editionNumber = tokenIdToEditionNumber[_tokenId];

    // Delete token ID mapping
    delete tokenIdToEditionNumber[_tokenId];

    // Delete tokens associated to the edition - this will leave a gap in the array of zero
    uint256[] storage tokenIdsForEdition = editionNumberToTokenIds[_editionNumber];
    uint256 editionTokenIdIndex = editionNumberToTokenIdIndex[_tokenId];
    delete tokenIdsForEdition[editionTokenIdIndex];
  }

  /**
   * @dev An extension to the default ERC721 behaviour, derived from ERC-875.
   * @dev Allowing for batch transfers from the sender, will fail if from does not own all the tokens
   */
  function batchTransfer(address _to, uint256[] memory _tokenIds) public {
    for (uint i = 0; i < _tokenIds.length; i++) {
      safeTransferFrom(ownerOf(_tokenIds[i]), _to, _tokenIds[i]);
    }
  }

  /**
   * @dev An extension to the default ERC721 behaviour, derived from ERC-875.
   * @dev Allowing for batch transfers from the provided address, will fail if from does not own all the tokens
   */
  function batchTransferFrom(address _from, address _to, uint256[] memory _tokenIds) public {
    for (uint i = 0; i < _tokenIds.length; i++) {
      transferFrom(_from, _to, _tokenIds[i]);
    }
  }

  //////////////////
  // Base Updates //
  //////////////////

  function updateTokenBaseURI(string calldata _newBaseURI)
  external
  onlyIfNotReal {
    require(bytes(_newBaseURI).length != 0);
    tokenBaseURI = _newBaseURI;
  }

  function updateNrCommissionAccount(address _nrCommissionAccount)
  external
  onlyIfNotReal {
    require(_nrCommissionAccount != address(0));
    nrCommissionAccount = _nrCommissionAccount;
  }

  /////////////////////
  // Edition Updates //
  /////////////////////

  function updateEditionTokenURI(uint256 _editionNumber, string calldata _uri)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    editionNumberToEditionDetails[_editionNumber].tokenURI = _uri;
  }

  function updatePriceInWei(uint256 _editionNumber, uint256 _priceInWei)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    editionNumberToEditionDetails[_editionNumber].priceInWei = _priceInWei;
  }

  function updateArtistCommission(uint256 _editionNumber, uint256 _rate)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    editionNumberToEditionDetails[_editionNumber].artistCommission = _rate;
  }

  function updateArtistsAccount(uint256 _editionNumber, address _artistAccount)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {

    EditionDetails storage _originalEditionDetails = editionNumberToEditionDetails[_editionNumber];

    uint256 editionArtistIndex = editionNumberToArtistIndex[_editionNumber];

    // Get list of editions old artist works with
    uint256[] storage editionNumbersForArtist = artistToEditionNumbers[_originalEditionDetails.artistAccount];

    // Remove edition from artists lists
    delete editionNumbersForArtist[editionArtistIndex];

    // Add new artists to the list
    uint256 newArtistsEditionIndex = artistToEditionNumbers[_artistAccount].length;
    artistToEditionNumbers[_artistAccount].push(_editionNumber);
    editionNumberToArtistIndex[_editionNumber] = newArtistsEditionIndex;

    // Update the edition
    _originalEditionDetails.artistAccount = _artistAccount;
  }

  function updateEditionType(uint256 _editionNumber, uint256 _editionType)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {

    EditionDetails storage _originalEditionDetails = editionNumberToEditionDetails[_editionNumber];

    // Get list of editions for old type
    uint256[] storage editionNumbersForType = editionTypeToEditionNumber[_originalEditionDetails.editionType];

    // Remove edition from old type list
    uint256 editionTypeIndex = editionNumberToTypeIndex[_editionNumber];
    delete editionNumbersForType[editionTypeIndex];

    // Add new type to the list
    uint256 newTypeEditionIndex = editionTypeToEditionNumber[_editionType].length;
    editionTypeToEditionNumber[_editionType].push(_editionNumber);
    editionNumberToTypeIndex[_editionNumber] = newTypeEditionIndex;

    // Update the edition
    _originalEditionDetails.editionType = _editionType;
  }

  function updateActive(uint256 _editionNumber, bool _active)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    editionNumberToEditionDetails[_editionNumber].active = _active;
  }

  function updateTotalSupply(uint256 _editionNumber, uint256 _totalSupply)
  public
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    require(tokensOfEdition(_editionNumber).length <= _totalSupply);
    editionNumberToEditionDetails[_editionNumber].totalSupply = _totalSupply;
  }

  function updateTotalAvailable(uint256 _editionNumber, uint256 _totalAvailable)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];

    require(_editionDetails.totalSupply <= _totalAvailable);

    uint256 originalAvailability = _editionDetails.totalAvailable;
    _editionDetails.totalAvailable = _totalAvailable;
    totalNumberAvailable = totalNumberAvailable.sub(originalAvailability).add(_totalAvailable);
  }

  function updateStartDate(uint256 _editionNumber, uint256 _startDate)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    editionNumberToEditionDetails[_editionNumber].startDate = _startDate;
  }

  function updateEndDate(uint256 _editionNumber, uint256 _endDate)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    editionNumberToEditionDetails[_editionNumber].endDate = _endDate;
  }

  function updateOptionalCommission(uint256 _editionNumber, uint256 _rate, address _recipient)
  external
  onlyIfNotReal
  onlyRealEdition(_editionNumber) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    uint256 artistCommission = _editionDetails.artistCommission;

    if (_rate > 0) {
      require(_recipient != address(0));
    }
    require(artistCommission.add(_rate) <= 100);

    editionNumberToOptionalCommissionSplit[_editionNumber] = CommissionSplit({rate : _rate, recipient : _recipient});
  }

  ///////////////////
  // Token Updates //
  ///////////////////

  function setTokenURI(uint256 _tokenId, string calldata _uri)
  external
  onlyIfNotReal
  onlyValidTokenId(_tokenId) {
    _setTokenURI(_tokenId, _uri);
  }

  ///////////////////
  // Query Methods //
  ///////////////////

  /**
   * @dev Lookup the edition of the provided token ID
   * @dev Returns 0 if not valid
   */
  function editionOfTokenId(uint256 _tokenId) public view returns (uint256 _editionNumber) {
    return tokenIdToEditionNumber[_tokenId];
  }

  /**
   * @dev Lookup all editions added for the given edition type
   * @dev Returns array of edition numbers, any zero edition ids can be ignore/stripped
   */
  function editionsOfType(uint256 _type) public view returns (uint256[] memory _editionNumbers) {
    return editionTypeToEditionNumber[_type];
  }

  /**
   * @dev Lookup all editions for the given artist account
   * @dev Returns empty list if not valid
   */
  function artistsEditions(address _artistsAccount) public view returns (uint256[] memory _editionNumbers) {
    return artistToEditionNumbers[_artistsAccount];
  }

  /**
   * @dev Lookup all tokens minted for the given edition number
   * @dev Returns array of token IDs, any zero edition ids can be ignore/stripped
   */
  function tokensOfEdition(uint256 _editionNumber) public view returns (uint256[] memory _tokenIds) {
    return editionNumberToTokenIds[_editionNumber];
  }

  /**
   * @dev Lookup all owned tokens for the provided address
   * @dev Returns array of token IDs
   */
  function tokensOf(address _owner) public view returns (uint256[] memory _tokenIds) {
    uint256 balance = balanceOf(_owner);

    uint256[] memory results = new uint256[](balance);

    for (uint256 idx = 0; idx < balance; idx++) {
        results[idx] = tokenOfOwnerByIndex(_owner, idx);
    }

    return results;
  }

  /**
   * @dev Checks to see if the edition exists, assumes edition of zero is invalid
   */
  function editionExists(uint256 _editionNumber) public view returns (bool) {
    if (_editionNumber == 0) {
      return false;
    }
    EditionDetails storage editionNumber = editionNumberToEditionDetails[_editionNumber];
    //console.log(editionNumber.editionNumber, _editionNumber);
    return editionNumber.editionNumber == _editionNumber;
  }

  /**
   * @dev Checks to see if the token exists
   */
  function exists(uint256 _tokenId) external view returns (bool) {
    return _exists(_tokenId);
  }

  /**
   * @dev Lookup any optional commission split set for the edition
   * @dev Both values will be zero if not present
   */
  function editionOptionalCommission(uint256 _editionNumber) public view returns (uint256 _rate, address _recipient) {
    CommissionSplit storage commission = editionNumberToOptionalCommissionSplit[_editionNumber];
    return (commission.rate, commission.recipient);
  }

  /**
   * @dev Main entry point for looking up edition config/metadata
   * @dev Reverts if invalid edition number provided
   */
  function detailsOfEdition(uint256 editionNumber)
  public view
  onlyRealEdition(editionNumber)
  returns (
    bytes32 _editionData,
    uint256 _editionType,
    uint256 _startDate,
    uint256 _endDate,
    address _artistAccount,
    uint256 _artistCommission,
    uint256 _priceInWei,
    string memory _tokenURI,
    uint256 _totalSupply,
    uint256 _totalAvailable,
    bool _active
  ) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[editionNumber];
    return (
    _editionDetails.editionData,
    _editionDetails.editionType,
    _editionDetails.startDate,
    _editionDetails.endDate,
    _editionDetails.artistAccount,
    _editionDetails.artistCommission,
    _editionDetails.priceInWei,
    StringsUtil.strConcat(tokenBaseURI, _editionDetails.tokenURI),
    _editionDetails.totalSupply,
    _editionDetails.totalAvailable,
    _editionDetails.active
    );
  }

  /**
   * @dev Lookup a tokens common identifying characteristics
   * @dev Reverts if invalid token ID provided
   */
  function tokenData(uint256 _tokenId)
  public view
  onlyValidTokenId(_tokenId)
  returns (
    uint256 _editionNumber,
    uint256 _editionType,
    bytes32 _editionData,
    string memory _tokenURI,
    address _owner
  ) {
    uint256 editionNumber = tokenIdToEditionNumber[_tokenId];
    EditionDetails storage editionDetails = editionNumberToEditionDetails[editionNumber];
    return (
    editionNumber,
    editionDetails.editionType,
    editionDetails.editionData,
    tokenURI(_tokenId),
    ownerOf(_tokenId)
    );
  }

  // function tokenURI(uint256 _tokenId) public override view onlyValidTokenId(_tokenId) returns (string memory) {
  //   return StringsUtil.strConcat(tokenBaseURI, super.tokenURI(_tokenId));
  // }

  // function tokenURISafe(uint256 _tokenId) public override view returns (string memory) {
  //   return StringsUtil.strConcat(tokenBaseURI, super.tokenURISafe(_tokenId));
  // }

  function purchaseDatesToken(uint256 _tokenId) public view returns (uint256 _startDate, uint256 _endDate) {
    uint256 _editionNumber = tokenIdToEditionNumber[_tokenId];
    return purchaseDatesEdition(_editionNumber);
  }

  function priceInWeiToken(uint256 _tokenId) public view returns (uint256 _priceInWei) {
    uint256 _editionNumber = tokenIdToEditionNumber[_tokenId];
    return priceInWeiEdition(_editionNumber);
  }



  //////////////////////////
  // Edition config query //
  //////////////////////////

  function editionData(uint256 _editionNumber) public view returns (bytes32) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.editionData;
  }

  function editionType(uint256 _editionNumber) public view returns (uint256) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.editionType;
  }

  function purchaseDatesEdition(uint256 _editionNumber) public view returns (uint256 _startDate, uint256 _endDate) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return (
    _editionDetails.startDate,
    _editionDetails.endDate
    );
  }

  function purchaseDatesActive(uint256 _editionNumber) public view returns (bool _isActive) {
    return editionNumberToEditionDetails[_editionNumber].startDate <= block.timestamp && editionNumberToEditionDetails[_editionNumber].endDate >= block.timestamp;
  }

  function purchaseDatesEnded(uint256 _editionNumber) public view returns (bool _ended) {
    return editionNumberToEditionDetails[_editionNumber].endDate < block.timestamp;
  }

  function artistCommission(uint256 _editionNumber) public view returns (address _artistAccount, uint256 _artistCommission) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return (
    _editionDetails.artistAccount,
    _editionDetails.artistCommission
    );
  }

  function priceInWeiEdition(uint256 _editionNumber) public view returns (uint256 _priceInWei) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.priceInWei;
  }

  function tokenURIEdition(uint256 _editionNumber) public view returns (string memory) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return StringsUtil.strConcat(tokenBaseURI, _editionDetails.tokenURI);
  }

  function editionActive(uint256 _editionNumber) public view returns (bool) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.active;
  }

  function totalRemaining(uint256 _editionNumber) public view returns (uint256) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.totalAvailable.sub(_editionDetails.totalSupply);
  }

  function totalAvailableEdition(uint256 _editionNumber) public view returns (uint256) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.totalAvailable;
  }

  function totalSupplyEdition(uint256 _editionNumber) public view returns (uint256) {
    EditionDetails storage _editionDetails = editionNumberToEditionDetails[_editionNumber];
    return _editionDetails.totalSupply;
  }

  function reclaimEther() external onlyOwner {
    payable(owner()).transfer(address(this).balance);
    acceptedToken.transfer(owner(), acceptedToken.balanceOf(address(this)));
  }

  function _beforeTokenTransfer(address from, address to, uint256 tokenId) internal virtual override(ERC721, ERC721Pausable) {
      super._beforeTokenTransfer(from, to, tokenId);
  }

}
