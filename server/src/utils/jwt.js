import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, tokenVersion: user.tokenVersion },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}
