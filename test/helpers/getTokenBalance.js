const toBN = require('./toBN');

function getTokenBalance(token) {
  return async address => {
    return toBN(await token.balanceOf(address));
  }
}

module.exports = getTokenBalance;
