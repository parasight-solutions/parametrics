import jwt from 'jsonwebtoken'
const secret = process.env.JWT_SECRET || 'dev_change_me'
export function signJwt(payload, opts={}) { return jwt.sign(payload, secret, { expiresIn: opts.expiresIn || '7d' }) }
export function verifyJwt(token) { return jwt.verify(token, secret) }
