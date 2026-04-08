import { createHmac } from 'crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/**
 * Generate a short-lived JWT for the Kling AI official API.
 *
 * Algorithm: HS256
 * Header:  { alg: "HS256", typ: "JWT" }
 * Payload: { iss: accessKey, exp: now + 1800, nbf: now - 5 }
 * Signed with secretKey.
 */
export function signKlingJwt(accessKey: string, secretKey: string): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const now = Math.floor(Date.now() / 1000)
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
  })))
  const signature = base64url(
    createHmac('sha256', secretKey).update(`${header}.${payload}`).digest(),
  )
  return `${header}.${payload}.${signature}`
}
