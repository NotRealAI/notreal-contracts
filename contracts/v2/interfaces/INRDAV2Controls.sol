pragma solidity 0.6.12;

/**
* Minimal interface definition for NRDA V2 contract calls
*
* https://www.notreal.ai/
*/
interface INRDAV2Controls {
  function mint(address _to, uint256 _editionNumber) external returns (uint256);

  function editionActive(uint256 _editionNumber) external view returns (bool);

  function artistCommission(uint256 _editionNumber) external view returns (address _artistAccount, uint256 _artistCommission);

  function updatePriceInWei(uint256 _editionNumber, uint256 _priceInWei) external;

  function updateActive(uint256 _editionNumber, bool _active) external;
}
