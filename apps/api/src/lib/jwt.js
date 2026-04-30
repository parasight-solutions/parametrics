import jwt from 'jsonwebtoken'
import { getJwtSecret } from "./authConfig.js";

export function signJwt(payload, opts={}) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: opts.expiresIn || '7d' })
}

export function verifyJwt(token) {
  return jwt.verify(token, getJwtSecret())
}
