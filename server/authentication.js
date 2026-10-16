import { recordDiagnostic } from './diagnostics.js'

export function createAuthenticator(admin) {
  return async function getAuthenticatedUser(req, res) {
    const header = req.headers?.authorization || req.headers?.Authorization
    const token =
      typeof header === 'string'
        ? header.trim().match(/^Bearer\s+(\S+)$/i)?.[1]
        : null
    const reject = (status, code, error) => {
      res.status(status).json({ code, error, requestId: res.locals?.requestId })
      return null
    }
    if (!token)
      return reject(
        401,
        'invalid_token',
        'Sesi login tidak ditemukan. Silakan masuk kembali.'
      )

    const unavailable = (error) => {
      recordDiagnostic('auth.unavailable', {
        requestId: res.locals?.requestId,
        status: 503,
        code: error?.code
      })
      res.setHeader('Retry-After', '15')
      return reject(
        503,
        'auth_unavailable',
        'Layanan login sementara tidak tersedia. Coba lagi sebentar.'
      )
    }
    try {
      const { data, error } = await admin.auth.getUser(token)
      if (!error && data?.user) return data.user
      const status = Number(error?.status)
      if (
        error &&
        /invalid api key|no api key found/i.test(String(error.message || ''))
      )
        return unavailable(error)
      if (
        [
          'bad_jwt',
          'jwt_expired',
          'session_not_found',
          'user_not_found'
        ].includes(error?.code)
      )
        return reject(
          401,
          'invalid_token',
          'Sesi login berakhir. Silakan masuk kembali.'
        )
      if (status === 403)
        return reject(
          403,
          'account_restricted',
          'Akses akun sedang dibatasi. Hubungi pengelola.'
        )
      if (
        !error ||
        status === 400 ||
        status === 401 ||
        error.name === 'AuthInvalidJwtError'
      )
        return reject(
          401,
          'invalid_token',
          'Sesi login berakhir. Silakan masuk kembali.'
        )
      // A timeout/upstream outage is not evidence that the user's token expired.
      return unavailable(error)
    } catch (error) {
      return unavailable(error)
    }
  }
}
