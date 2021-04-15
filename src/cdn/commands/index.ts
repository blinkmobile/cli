import type { CLICommand } from '../../commands'

import meow from 'meow'

import getHelp from '../cli/help'

export const meowOptions: Parameters<typeof meow>[0] = {
  flags: {
    debug: {
      type: 'boolean',
      default: false,
    },
    force: {
      type: 'boolean',
      default: false,
    },
    prune: {
      type: 'boolean',
      default: false,
    },
    skip: {
      type: 'boolean',
      default: true,
    },
    bucket: {
      type: 'string',
    },
    cwd: {
      type: 'string',
      default: process.cwd(),
    },
    env: {
      type: 'string',
      default: 'dev',
    },
  },
}

const command: CLICommand = async (tenant, inputs, oneBlinkAPIClient) => {
  try {
    const help = getHelp(tenant)
    const { flags } = meow(help, meowOptions)

    const command = await getCLICommand(inputs[0])

    if (flags.help || typeof command !== 'function') {
      console.log(help)
      return
    }

    return command(inputs.slice(1), flags, oneBlinkAPIClient)
  } catch (err) {
    console.error('Command not found!')
  }
}

async function getCLICommand(input: string) {
  switch (input) {
    case 'scope': {
      return (await import('./scope')).default
    }
    case 'deploy': {
      return (await import('./deploy')).default
    }
  }
}

export default command
