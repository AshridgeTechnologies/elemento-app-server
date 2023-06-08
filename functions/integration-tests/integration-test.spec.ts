import {test} from 'node:test'
import {expect} from 'expect'

test("Runs function in test GitHub repo", async () => {
  const url = 'http://127.0.0.1:5001/elemento-test/europe-west2/ext-appServer-appServer/capi/ServerApp1/AddTen?abc=20';
  const result = await fetch(url).then(resp => resp.json())
  expect(result).toBe(30)
})
