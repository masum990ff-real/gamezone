const rateLimit = require("express-rate-limit");

function limiter(max, message) {
  return rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, data: {}, message },
  });
}

const loginLimiter = limiter(10, "Too many login attempts, try again in a minute");
const syncLimiter = limiter(5, "Account limit: max 5 per minute, try again later");
const registerLimiter = limiter(60, "Too many requests, try again later");
const sendLimiter = limiter(20, "Too many notifications, try again in a minute");

module.exports = { loginLimiter, syncLimiter, registerLimiter, sendLimiter };
