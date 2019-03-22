import Aragon from "@aragon/client";
import CID from 'cids'
import IPFS from 'ipfs-http-client'
import IPLD from 'ipld'
import IPLDGit from 'ipld-git'
import { parsePersonLine, cidToSha } from 'ipld-git/src/util/util.js'

const app = new Aragon()
const ipfs = IPFS({ host: 'localhost', port: '5001', protocol: 'http' })
const ipld = new IPLD({
  blockService: ipfs.block,
  formats: [IPLDGit],
})

app
  .call('name')
  .toPromise()
  .then(name => {
    app.identify(name)
  })
  .catch(err => {
    console.error('Failed to load information to identify repository app due to:', err)
  })


app.store(async (state, event) => {
  state = state ? state : { branches: {}, name: '', description: '' }

  switch (event.event) {
    case "UpdateRef":
      try {
        // state.branches[branchFromRef(event.returnValues.ref)] =
        //   event.returnValues.hash
        state.branches[branchFromRef(event.returnValues.ref)] = await fetchHistory(event.returnValues.hash, [])
      } catch (err) {
        console.error('Failed to load commit history due to:', err)
      }
      return state
    case "UpdateInformations":
      state.name = event.returnValues.name
      state.description = event.returnValues.description
      return state
    default:
      return state
  }
})

const branchFromRef = ref => {
  return ref.split("/")[2]
}

const fetchHistory = async (hash, history) => {
  return new Promise((resolve, reject) => {
    try {
      ipld.get(new CID(hash), async (err, result) => {
        if (err) {
          reject(err)
        } else {
          const commit = result.value
          commit.cid = hash
          commit.sha = cidToSha(hash).toString('hex')

          history.push(commit)

          for (let parent of commit.parents) {
            history = await fetchHistory(parent['/'], history)
          }

          resolve(history)
        }
      })
    } catch (err) {
      reject(err)
    }
  })
}
