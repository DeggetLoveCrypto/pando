import CID from 'cids'
import IPFS from 'ipfs-http-client'
import IPLD from 'ipld'
import IPLDGit from 'ipld-git'
import {cidToSha, shaToCid } from 'ipld-git/src/util/util'


export default class IPLDHelper {

  private _ipfs: IPFS
  private _ipld: IPLD

  constructor() {
    this._ipfs = IPFS({ host: 'localhost', port: '5001', protocol: 'http' })
    this._ipld = new IPLD({
      blockService: this._ipfs.block,
      formats: [IPLDGit]
    })
  }

  public async deserialize(buffer: Buffer): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      IPLDGit.util.deserialize(buffer, (err, node) => {
        if (err) {
          reject(err)
        } else {
          resolve(node)
        }
      })
    })
  }

  public async serialize(node: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      IPLDGit.util.serialize(node, async (err, buffer) => {
        if (err) {
          reject(err)
        } else {
          resolve(buffer)
        }
      })
    })
  }

  public async put(object: any): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this._ipld.put(object, { format: 'git-raw'}, (err, cid) => {
        if (err) {
          reject(err)
        } else {
          resolve(cid)
        }
      })
    })
  }

  public async get(cid: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this._ipld.get(new CID(cid), (err, result) => {
        if (err) {
          reject(err)
        } else {
          resolve(result.value)
        }
      })
    })
  }

  public async cid(object: any): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this._ipld.put(object, { format: 'git-raw', onlyHash: true }, (err, cid) => {
        if (err) {
          reject(err)
        } else {
          resolve(cid.toBaseEncodedString())
        }
      })
    })
  }

  public shaToCid(oid: string): string {
    return (new CID(shaToCid(Buffer.from(oid, 'hex')))).toBaseEncodedString()
  }

  public cidToSha(cid: string): string {
    return cidToSha(new CID(cid)).toString('hex')
  }
}
