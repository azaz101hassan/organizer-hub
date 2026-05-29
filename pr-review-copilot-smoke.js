// Smoke fixture for the AI PR Review Copilot dogfood test.
// Re-review trigger (Stage 2 after the jobId fix). Violations remain.
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

// Deliberate no-var violation.
function countItems(items) {
  var total = 0;
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].qty;
  }
  return total;
}

module.exports = { isPending, countItems };
