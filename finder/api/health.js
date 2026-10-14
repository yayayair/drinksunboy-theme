// GET /api/health → confirms which settings are present (never their values).
export default function handler(req, res) {
  res.status(200).json({ vipCustId: !!process.env.VIP_CUST_ID, vipSharedCode: !!process.env.VIP_SHARED_CODE, googleKey: !!process.env.GOOGLE_PLACES_API_KEY });
}
