/* @flow */
'use strict'

/* ::
import type OneBlinkAPIClient from '../oneblink-api-client'

import type {
  APIDeploymentPayload,
  BlinkMRCServer,
  DeploymentCredentials
} from './types.js'
*/

const util = require('util')
const fs = require('fs')
const path = require('path')

const archiver = require('archiver')
const AWS = require('aws-sdk')
const chalk = require('chalk')
const execa = require('execa')
const inquirer = require('inquirer')
const temp = require('temp').track()
const ora = require('ora')
const writeJsonFile = require('write-json-file')

const readCors = require('./cors/read.js')
const readRoutes = require('./routes/read.js')
const network = require('./network.js')
const validateCors = require('./cors/validate.js')
const copyRecursive = require('./utils/copy-recursive.js')
const awsRoles = require('./assume-aws-roles.js')
const values = require('./values.js')
const variables = require('./variables.js')
const { ENTRY_FUNCTION } = require('./handlers.js')

const EXT = 'zip'
const HANDLER = 'handler'
const pMkdir = util.promisify(temp.mkdir)

const getProjectPath = (target) => path.join(target, 'project')

async function authenticate(
  oneBlinkAPIClient /* : OneBlinkAPIClient */,
  config /* : BlinkMRCServer */,
  env /* : string */,
) /* : Promise<DeploymentCredentials> */ {
  const spinner = ora('Authenticating...').start()
  try {
    const awsCredentials = await awsRoles.assumeAWSRoleToDeploy(
      oneBlinkAPIClient,
      config,
      env,
    )

    spinner.succeed('Authentication complete!')

    return awsCredentials
  } catch (err) {
    spinner.fail('Authentication failed...')
    throw err
  }
}

function confirm(
  logger /* : typeof console */,
  force /* : boolean */,
  env /* : string */,
) /* : Promise<boolean> */ {
  if (force) {
    return Promise.resolve(true)
  }
  logger.log(
    chalk.yellow(`
Please check configuration before continuing
`),
  )
  const promptQuestions = [
    {
      type: 'confirm',
      name: 'confirmation',
      message: `Are you sure you want to deploy to environment "${env}": [Y]`,
    },
  ]
  return inquirer
    .prompt(promptQuestions)
    .then((results) => results.confirmation)
}

async function copy(
  deploymentCredentials /* : DeploymentCredentials */,
  config /* : BlinkMRCServer */,
  cwd /* : string */,
  env /* : string */,
) /* : Promise<[string, APIDeploymentPayload]> */ {
  const spinner = ora('Validating project...').start()
  try {
    const scope = config.project
    if (!scope) {
      throw new Error('scope has not been set yet')
    }

    const target = await pMkdir('api-deployment')

    // Copy project code
    await copyRecursive(cwd, getProjectPath(target))

    // Copy AWS Lambda entry point handler
    const wrapperPath = path.join(__dirname, '..', '..', 'dist', 'wrapper.js')
    const handlerPath = path.join(target, `${HANDLER}.js`)
    await copyRecursive(wrapperPath, handlerPath)

    // Copy configuration file required by handler
    const configPath = path.join(target, 'bm-server.json')

    const [cors, routes, networkConfig, envVars] = await Promise.all([
      readCors(cwd).then((cors) => (cors ? validateCors(cors) : false)),
      readRoutes(cwd),
      network.readNetwork(cwd, env),
      variables.read(cwd, env),
    ])

    const apiDeploymentPayload /* : APIDeploymentPayload */ = {
      s3: deploymentCredentials.s3,
      analytics: config.analytics,
      timeout: config.timeout || values.DEFAULT_TIMEOUT_SECONDS,
      cors,
      handler: `${HANDLER}.${ENTRY_FUNCTION}`,
      routes: routes.map((routeConfig) => {
        routeConfig.module = path.posix.join('project', routeConfig.module)
        return routeConfig
      }),
      scope,
      env,
      network: networkConfig,
      runtime: values.AWS_LAMBDA_RUNTIME,
      variables: envVars,
      memorySize: config.memorySize,
    }

    await writeJsonFile(configPath, apiDeploymentPayload)

    spinner.succeed('Validation complete!')
    return [target, apiDeploymentPayload]
  } catch (error) {
    spinner.fail('Validation failed...')
    throw error
  }
}

async function deploy(
  oneblinkAPIClient /* : OneBlinkAPIClient */,
  apiDeploymentPayload /* : APIDeploymentPayload */,
  env /* : string */,
) /* : Promise<void> */ {
  const spinner = ora(`Provisioning environment "${env}"...`).start()
  try {
    const deployData = await oneblinkAPIClient.postRequest(
      `/apis/${apiDeploymentPayload.scope}/environments/${env}/deployments`,
      apiDeploymentPayload,
    )

    spinner.succeed(
      'Deployment complete - Origin: ' + chalk.bold(deployData.brandedUrl),
    )
  } catch (error) {
    spinner.fail(`Provisioning environment "${env}" failed!`)
    throw error
  }
}

async function pruneDevDependencies(
  target /* : string */,
) /* : Promise<void> */ {
  const spinner = ora('Removing developer dependencies...').start()
  try {
    await execa('npm', ['prune', '--production'], {
      cwd: getProjectPath(target),
    })

    spinner.succeed('Removed developer dependencies!')
  } catch (error) {
    // Ignore errors when attempting to remove dev dependencies
    spinner.fail('Removing developer dependencies failed...')
  }
}

async function upload(
  zipFilePath /* : string */,
  deploymentCredentials /* : DeploymentCredentials */,
) /* : Promise<void> */ {
  const spinner = ora('Transferring project...').start()
  let progress = 0

  try {
    const src = fs.createReadStream(zipFilePath)
    const s3 = new AWS.S3(deploymentCredentials.credentials)
    const params = {
      Bucket: deploymentCredentials.s3.bucket,
      Key: deploymentCredentials.s3.key,
      Body: src,
    }

    const manager = s3.upload(params)
    manager.on('httpUploadProgress', (uploadProgress) => {
      // Note that total may be undefined until the payload size is known.
      // http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3/ManagedUpload.html
      if (uploadProgress.total) {
        progress = Math.floor(
          (uploadProgress.loaded / uploadProgress.total) * 100,
        )
        spinner.text = `Transferring project: ${progress}%`
      }
    })

    await new Promise((resolve, reject) => {
      manager.send((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
    spinner.succeed('Transfer complete!')
  } catch (error) {
    spinner.fail(`Transfer failed: ${progress}%`)
    throw error
  }
}

async function zip(target /* : string */) /* : Promise<string> */ {
  const spinner = ora('Compressing project...').start()
  try {
    const archive = archiver.create(EXT, {})
    const output = temp.createWriteStream({ suffix: `.${EXT}` })
    archive.pipe(output)
    archive.glob('**/*', {
      cwd: target,
      nodir: true,
      dot: true,
      ignore: ['.git/**'],
    })
    archive.finalize()
    const zipFilePath = await new Promise((resolve, reject) => {
      const fail = (err) => {
        reject(err)
      }

      archive.on('error', (err) => fail(err))
      output.on('error', (err) => fail(err))
      output.on('finish', () => {
        resolve(output.path)
      })
    })

    spinner.succeed('Compression complete!')
    return zipFilePath
  } catch (error) {
    spinner.fail('Compression failed...')
    throw error
  }
}

module.exports = {
  authenticate,
  confirm,
  copy,
  deploy,
  pruneDevDependencies,
  upload,
  zip,
}
