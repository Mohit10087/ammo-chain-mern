const QRCode = require('qrcode');

/**
 * Encodes just the lotID as a QR code (data URL, PNG). The physical
 * scan/scan-out flow is simulated by the frontend's Scan page, which reads
 * this code (camera-based decode, or manual entry as a fallback) and calls
 * the transfer/consumption/dispose endpoints - so ledger state and the
 * "physical" movement stay in sync without needing real RFID/QR hardware.
 */
async function generateLotQRCode(lotID) {
  return QRCode.toDataURL(lotID, { errorCorrectionLevel: 'M', margin: 1, width: 256 });
}

module.exports = { generateLotQRCode };
