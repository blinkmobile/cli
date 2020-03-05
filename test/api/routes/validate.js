'use strict'

const test = require('ava')
const proxyquire = require('proxyquire')

const TEST_SUBJECT = '../../../lib/api/routes/validate.js'

const CWD = 'current working directory'
const PATH_RESOLVE = 'returned from path resolve'
const MODULE = 'module path'

test.beforeEach(t => {
  t.context.getTestSubject = overrides => {
    overrides = overrides || {}
    return proxyquire(
      TEST_SUBJECT,
      Object.assign(
        {
          path: {
            resolve: () => PATH_RESOLVE,
          },

          '@jokeyrhyme/pify-fs': {
            stat: path => Promise.resolve(),
          },
        },
        overrides,
      ),
    )
  }
})

test('Should contain error if route does not start with "/"', t => {
  const validate = t.context.getTestSubject()

  return validate(CWD, {
    route: 'test',
    module: 'test',
  }).then(errors => t.deepEqual(errors, ['Route must start with a "/"']))
})

test('Should contain error if timeout is invalid', t => {
  const validate = t.context.getTestSubject()
  const tests = [
    {
      args: { route: '/test', module: 'test', timeout: 0 },
      expected: ['Timeout must be between 1 and 300 (inclusive)'],
    },
    {
      args: { route: '/test', module: 'test', timeout: 301 },
      expected: ['Timeout must be between 1 and 300 (inclusive)'],
    },
    { args: { route: '/test', module: 'test', timeout: 1 }, expected: [] },
    { args: { route: '/test', module: 'test', timeout: 300 }, expected: [] },
  ]

  return tests.reduce((prev, config) => {
    return prev
      .then(() => validate(CWD, config.args))
      .then(result => t.deepEqual(result, config.expected))
  }, Promise.resolve())
})

test('Should contain error message if module can not be found', t => {
  const errorMessage = 'This is an error'
  const validate = t.context.getTestSubject({
    '@jokeyrhyme/pify-fs': {
      stat: path => Promise.reject(new Error(errorMessage)),
    },
  })
  return validate(CWD, {
    route: '/test',
    module: 'test',
  }).then(errors => t.deepEqual(errors, [errorMessage]))
})

test('Should contain different error message if module can not be found with ENOENT code', t => {
  const validate = t.context.getTestSubject({
    '@jokeyrhyme/pify-fs': {
      stat: path => {
        const err = new Error()
        err.code = 'ENOENT'
        return Promise.reject(err)
      },
    },
  })
  return validate(CWD, {
    route: '/test',
    module: MODULE,
  }).then(errors => t.deepEqual(errors, [`Could not find module: ${MODULE}`]))
})

test('Input for for fs.stat() should be the result of path.resolve()', t => {
  t.plan(3)
  const validate = t.context.getTestSubject({
    path: {
      resolve: (cwd, moduleString) => {
        t.is(cwd, CWD)
        t.is(moduleString, MODULE)
        return PATH_RESOLVE
      },
    },
    '@jokeyrhyme/pify-fs': {
      stat: path => {
        t.is(path, PATH_RESOLVE)
        return Promise.resolve()
      },
    },
  })
  return validate(CWD, {
    route: '/test',
    module: MODULE,
  })
})
