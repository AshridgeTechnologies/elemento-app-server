import {test} from 'node:test'
import {expect} from 'expect'

import {CloudStorageCache} from '../src/util'
import os from 'os'
import fs from 'fs'
import admin from 'firebase-admin'

const fileContent = 'some code'
const bucketName = 'elemento-unit-test.appspot.com'

const serviceAccount = JSON.parse(fs.readFileSync('private/elemento-unit-test-service-account-key.json', 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccount), storageBucket: bucketName})

test('app Server', async (t) => {
    await t.test('CloudStorageCache saves and retrieves files with URL as key', async () => {
        const fileUrl = `https://raw.githubusercontent.com/theUser/theRepo/theFile.${Date.now()}.js`
        const downloadDir = os.tmpdir() + '/' + 'CloudStorageCache.test.1'
        await fs.promises.rm(downloadDir, {force: true, recursive: true})
        await fs.promises.mkdir(downloadDir)
        const downloadFilePath = downloadDir + '/' + 'retrievedFile.txt'

        const cache = new CloudStorageCache()
        await expect(cache.downloadToFile(fileUrl, downloadFilePath)).resolves.toBe(false)
        await cache.store(fileUrl, fileContent)
        await expect(cache.downloadToFile(fileUrl, downloadFilePath)).resolves.toBe(true)
        const retrievedContent = await fs.promises.readFile(downloadFilePath, 'utf8')
        expect(retrievedContent).toBe(fileContent)
    })
})