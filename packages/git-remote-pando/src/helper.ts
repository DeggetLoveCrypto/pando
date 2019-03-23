import debug from 'debug'
import ETHProvider from 'eth-provider'
import fs from 'fs-extra'
import json from 'jsonfile'
import Level from 'level'
import git from 'nodegit'
import ora from 'ora'
import os from 'os'
import path from 'path'
import shell from 'shelljs'
import contractor from 'truffle-contract'
import Web3 from 'web3'
import GitHelper from './lib/git'
import IPLDHelper from './lib/ipld'
import LineHelper from './lib/line'

const _timeout = async (duration: any): Promise<void> => {
  return new Promise<any>((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, duration)
  })
}

export default class Helper {
  public name: string
  public url: string
  public path: string
  public address: string
  public config: any
  public debug: any // put it private ?
  public line: LineHelper
  public git: GitHelper
  public ipld: IPLDHelper

  // private _repo!: any
  private _db: any
  private _artifact: any
  private _contract!: any
  private _provider: any
  private _web3: any

  constructor(name: string = '_', url: string) {
    // name and url
    this.name = name
    this.url = url

    // address and path shortcuts
    this.address = this.url.split('://')[1]
    this.path = path.resolve(process.env.GIT_DIR as string)

    // config
    this.config = this._config()

    // lib
    this.debug = debug('pando')
    this.line = new LineHelper()
    this.git = new GitHelper(this)
    this.ipld = new IPLDHelper()
  }

  //OK
  public async initialize(): Promise<void> {
    // create dirs
    fs.ensureDirSync(path.join(this.path, 'refs', 'remotes', this.name))
    fs.ensureDirSync(path.join(this.path, 'pando', 'refs'))

    // load db
    this._db = Level(path.join(this.path, 'pando', 'refs', this.address))

    // initialize web3
    this._provider = await this._ethConnect()
    this._web3 = new Web3(this._provider)

    // initialize contract
    this._artifact = contractor(require('@pando/repository/build/contracts/PandoRepository.json'))
    this._artifact.setProvider(this._provider)
    this._artifact.defaults({
      gas: 30e6,
      gasPrice: 15000000001,
      from: this.config.ethereum.account,
    })
    this._contract = await this._artifact.at(this.address, { from: this.config.ethereum.address })
  }

  // OK
  public async run(): Promise<void> {
    while (true) {
      const cmd = await this.line.next()

      switch (this._cmd(cmd)) {
        case 'capabilities':
          await this._handleCapabilities()
          break
        case 'list for-push':
          await this._handleList({ forPush: true })
          break
        case 'list':
          await this._handleList()
          break
        case 'fetch':
          await this._handleFetch(cmd)
          break
        case 'push':
          await this._handlePush(cmd)
          break
        case 'end':
          this._exit()
        case 'unknown':
          throw new Error('Unknown command: ' + cmd)
      }
    }
  }

  /***** commands handling methods *****/

  // OK
  private async _handleCapabilities(): Promise<void> {
    this.debug('cmd', 'capabilities')
    // this._send('option')
    this._send('fetch')
    this._send('push')
    this._send('')
  }

  // OK
  private async _handleList({ forPush = false }: { forPush?: boolean } = {}): Promise<void> {
    forPush ? this.debug('cmd', 'list', 'for-push') : this.debug('cmd, list')

    const refs = await this._fetchRefs()

    for (const ref in refs) {
      this._send(this.ipld.cidToSha(refs[ref]) + ' ' + ref)
    }

    // force HEAD to master and update once pando handle symbolic refs
    this._send('@refs/heads/master' + ' ' + 'HEAD')
    this._send('')
  }

  // OK
  private async _handleFetch(line: string): Promise<void> {
    this.debug('cmd', line)

    while (true) {
      const [cmd, oid, name] = line.split(' ')
      await this._fetch(oid, name)
      line = await this.line.next()

      if (line === '') break
    }

    this._send('')
  }

  // OK
  private async _handlePush(line: string): Promise<void> {
    this.debug('cmd', line)

    while (true) {
      const [src, dst] = line.split(' ')[1].split(':')

      if (src === '') {
        await this._delete(dst)
      } else {
        await this._push(src, dst)
      }

      line = await this.line.next()

      if (line === '') break
    }

    this._send('')
  }

  /***** refs db methods *****/

  // OK
  private async _fetchRefs(): Promise<object> {
    this.debug('fetching remote refs from chain')

    let start
    let block
    let events
    const ops: object[] = []
    const updates: object = {}
    const spinner = ora('Fetching remote refs from chain [this may take a while]').start()

    try {
      start = await this._db.get('@block')
    } catch (err) {
      if (err.message === 'Key not found in database [@block]') {
        start = 0
      } else {
        throw err
      }
    }

    try {
      block = await this._web3.eth.getBlockNumber()
      events = await this._contract.getPastEvents('UpdateRef', {
        fromBlock: start,
        toBlock: 'latest',
      })

      for (const event of events) {
        updates[event.args.ref] = event.args.hash
      }

      for (const ref in updates) {
        ops.push({ type: 'put', key: ref, value: updates[ref] })
      }

      ops.push({ type: 'put', key: '@block', value: block })

      await this._db.batch(ops)

      spinner.succeed('Remote refs fetched from chain')

      return this._getRefs()
    } catch (err) {
      spinner.fail('Failed to fetch remote refs from chain')
      throw err
    }
  }

  // OK
  private async _getRefs(): Promise<object> {
    this.debug('reading refs from local db')

    const refs: any = {}

    return new Promise<object>((resolve, reject) => {
      this._db
        .createReadStream()
        .on('data', ref => {
          if (ref.key !== '@block') refs[ref.key] = ref.value
        })
        .on('error', err => {
          reject(err)
        })
        .on('end', function() {
          //
        })
        .on('close', function() {
          resolve(refs)
        })
    })
  }

  /***** core methods *****/

  // OK
  private async _fetch(oid: string, ref: string): Promise<void> {
    this.debug('fetching', ref, oid, this.ipld.shaToCid(oid))
    await this.git.download(oid)
  }

  // OK
  private async _push(src: string, dst: string): Promise<void> {
    this.debug('pushing', src, 'to', dst)

    let spinner
    let head
    let mapping: any = {}
    const ops: any = []

    try {
      const refs = await this._getRefs()
      const remote: any = refs[dst]

      const srcBranch = src.split('/').pop()
      const dstBranch = dst.split('/').pop()

      const revListCmd = remote ? `git rev-list --left-only ${srcBranch}...${this.name}/${dstBranch}` : 'git rev-list --all'

      const commits = shell
        .exec(revListCmd, { silent: true })
        .stdout.split('\n')
        .slice(0, -1)

      // collect git objects
      try {
        spinner = ora('Collecting git objects [this may take a while]').start()

        for (const commit of commits) {
          const _mapping = await this.git.collect(commit, mapping)
          mapping = { ...mapping, ..._mapping }
        }

        head = this.ipld.shaToCid(commits[0])

        for (const entry in mapping) {
          ops.push(this.ipld.put(mapping[entry]))
        }

        spinner.succeed('Git objects collected')
      } catch (err) {
        spinner.fail('Failed to collect git objects: ' + err.message)
        this._die()
      }

      // upload git objects
      try {
        spinner = ora('Uploading git objects to IPFS').start()
        await Promise.all(ops)
        spinner.succeed('Git objects uploaded to IPFS')
      } catch (err) {
        spinner.fail('Failed to upload git objects to IPFS: ' + err.message)
        this._die()
      }

      // register on chain
      try {
        spinner = ora(`Registering ref ${dst} ${head} on-chain`).start()
        await this._contract.push(dst, head)
        spinner.succeed(`Ref ${dst} ${head} registered on-chain`)
      } catch (err) {
        spinner.fail(`Failed to register ref ${dst} ${head} on-chain: ` + err.message)
        this._die()
      }

      this._send(`ok ${dst}`)
    } catch (err) {
      this._die(err)
    }
  }

  // TODO
  private async _delete(dst: string): Promise<void> {
    this.debug('deleting', dst)
  }

  /***** utility methods *****/

  // OK
  private async _ethConnect(): Promise<any> {
    this.debug('connecting to gateway', this.config.ethereum.gateway)

    const provider = ETHProvider(this.config.ethereum.gateway, { __frameOrigin: 'pando ' })
    const spinner = ora('Connecting to Ethereum').start()

    while (true) {
      try {
        const accounts = await provider.send('eth_accounts')
        spinner.stop()
        for (const account of accounts) {
          if (account === this.config.ethereum.account) return provider
        }
        this._die("Failed to access your Ethereum account. Update your gateway configuration or run 'git pando config' to select another account.")
      } catch (err) {
        if (err.code === 4100 || err.code === 4001) {
          spinner.text = `Error connecting to Ethereum. ${err.message}.`
          await _timeout(2000)
        } else {
          spinner.stop()
          this._die('Failed to connect to Ethereum. Make sure your Ethereum gateway is running.')
          this._die()
        }
      }
    }
  }

  // OK
  private _config(): any {
    const LOCAL = path.join(this.path, 'pando', '.pandorc')
    const GLOBAL = path.join(os.homedir(), '.pandorc')

    if (fs.pathExistsSync(LOCAL)) return json.readFileSync(LOCAL)
    if (fs.pathExistsSync(GLOBAL)) return json.readFileSync(GLOBAL)

    this._die("No configuration file found. Run 'git-pando config' and come back to us.")
  }

  // OK
  private _cmd(line: string): string {
    if (line === 'capabilities') {
      return 'capabilities'
    } else if (line === 'list for-push') {
      return 'list for-push'
    } else if (line === 'list') {
      return 'list'
    } else if (line.startsWith('option')) {
      return 'option'
    } else if (line.startsWith('fetch')) {
      return 'fetch'
    } else if (line.startsWith('push')) {
      return 'push'
    } else if (line === '') {
      return 'end'
    } else {
      return 'unknown'
    }
  }

  // OK
  private _send(message): void {
    // tslint:disable-next-line:no-console
    console.log(message)
  }

  // OK
  private _die(message?: string): void {
    // tslint:disable-next-line:no-console
    if (message) console.error(message)
    process.exit(1)
  }

  // OK
  private _exit(): void {
    process.exit(0)
  }
}
