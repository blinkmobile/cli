// @flow
'use strict'

const test = require('ava')
const proxyquire = require('proxyquire')

const userConfigStoreMock = require('../helpers/user-config.js')
const requestMock = require('../helpers/request.js')
const config = require('../../../lib/config.js')

const TEST_SUBJECT = '../../../lib/identity/common/logout.js'

const JWT = 'a valid jwt'

test('logout() should reject if a request returns an error', t => {
  const logout = proxyquire(TEST_SUBJECT, {
    request: requestMock(null, (url, callback) => {
      callback(new Error('Test error message'))
    }),
    '../utils/user-config.js': userConfigStoreMock(
      null,
      (updateFn, options) => {
        return Promise.resolve(updateFn({ accessToken: JWT }))
      },
    ),
  })

  return logout(config.TENANTS.ONEBLINK).catch(error => {
    t.deepEqual(error, new Error('Test error message'))
  })
})

test.cb(
  'logout() should call userConfigStore.update() to update and remove access token',
  t => {
    const logout = proxyquire(TEST_SUBJECT, {
      request: requestMock(null, (url, callback) => {
        callback(null, {}, 'OK')
      }),
      '../utils/user-config.js': userConfigStoreMock(null, updateFn => {
        t.pass()
        t.end()
        return Promise.resolve(updateFn({ accessToken: JWT }))
      }),
    })

    logout(config.TENANTS.ONEBLINK).catch(() => {
      t.fail()
      t.end()
    })
  },
)
