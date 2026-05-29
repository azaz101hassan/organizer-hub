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

// Added on synchronize: deliberate no-var violation.
function countItems(items) {
  var total = 0;
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].qty;
  }
  return total;
}

module.exports = { isPending, countItems };
