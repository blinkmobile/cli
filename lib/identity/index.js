/* @flow */
'use strict'

const jwt = require('jsonwebtoken')

const login = require('./common/login.js')
const logout = require('./common/logout.js')
const verifyJWT = require('./utils/verify-jwt.js')
const getJWT = require('./utils/get-jwt.js')

class OneBlinkIdentity {
  async login(
    tenant /* : Tenant */,
    options /* : LoginOptions */,
  ) /* : Promise<string> */ {
    return login(tenant, options)
  }

  async logout(tenant /* : Tenant */) /* : Promise<void> */ {
    return logout(tenant)
  }

  async getAccessToken() /* : Promise<string> */ {
    if (process.env.BLINKM_ACCESS_KEY && process.env.BLINKM_SECRET_KEY) {
      const key = process.env.BLINKM_ACCESS_KEY
      const secret = process.env.BLINKM_SECRET_KEY
      const expiryInMS = Date.now() + 1000 * 60 * 15 // expires in 15 minutes
      return Promise.resolve(
        jwt.sign(
          {
            iss: key,
            exp: Math.floor(expiryInMS / 1000), // exp claim should be in seconds, not milliseconds
          },
          secret,
        ),
      )
    }
    const token = await getJWT()
    return verifyJWT(token)
  }

  async getPayload(accessToken /* : string | void */) /* : Promise<Object> */ {
    const token = accessToken || (await this.getAccessToken())
    return jwt.decode(token)
  }
}

module.exports = OneBlinkIdentity

/* ::
export type LoginOptions = {
  password?: string,
  username?: string | true,
  storeJwt?: boolean
}

export type UserConfigStore = {
  load: () => Promise<Object>,
  update: (Object) => Promise<Object>
}
*/
