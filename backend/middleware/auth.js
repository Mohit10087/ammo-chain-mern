const jwt = require('jsonwebtoken');

/**
 * Verifies the JWT and attaches { id, username, org, depotId } to req.actor.
 * The token's `org` claim is the direct equivalent of the Fabric attribute
 * that chaincode ABAC would check (e.g. `org=Depot`). Keeping it in a signed
 * JWT rather than a client-supplied header is what makes this genuinely
 * access-controlled rather than just labelled.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.actor = decoded; // { id, username, org, displayName, depotId }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Restricts a route to a fixed set of orgs - the direct analogue of gating a
 * chaincode function with ABAC on the caller's org attribute. Commander is
 * never included here for write routes: it is read-only across every org by
 * design (see routes/dashboardRoutes.js).
 */
function requireOrg(...allowedOrgs) {
  return (req, res, next) => {
    if (!req.actor) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowedOrgs.includes(req.actor.org)) {
      return res.status(403).json({ error: `This action requires one of: ${allowedOrgs.join(', ')}` });
    }
    next();
  };
}

module.exports = { authenticate, requireOrg };
