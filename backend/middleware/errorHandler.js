// Catches ContractError (business-rule violations) as well as unexpected
// errors, so routes can just `next(err)` without duplicating status logic.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) {
    console.error(err);
  }
  res.status(statusCode).json({ error: err.message || 'Internal server error' });
}

module.exports = errorHandler;
