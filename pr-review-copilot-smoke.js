// Smoke fixture for the AI PR Review Copilot dogfood test.
// Deliberate eqeqeq violations: == / != where === / !== are required.
function isPending(order) {
  if (order.status == "pending") {
    return true;
  }
  if (order.couponCode != null) {
    return false;
  }
  return false;
}

module.exports = { isPending };
