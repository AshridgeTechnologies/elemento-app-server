import {test} from 'node:test'
import {expect} from 'expect'

import * as os from 'os'
import * as fs from 'fs'
// @ts-ignore
import admin from 'firebase-admin'
import {clearDirectory} from './testUtil'
import {CloudStorageCache} from '../src/CloudStorageCache'

const fileContent = 'some code'
const fileContentBuf = Buffer.from(fileContent, 'utf8')

const bucketName = 'elemento-unit-test.appspot.com'

const serviceAccountKey = JSON.parse(fs.readFileSync('private/elemento-unit-test-service-account-key-2.json', 'utf8'))
admin.initializeApp({credential: admin.credential.cert(serviceAccountKey), storageBucket: bucketName})

test('app Server', async (t) => {
    await t.test('CloudStorageCache saves and retrieves files with URL as key', async () => {
        const fileUrl = `dir1/theFile.${Date.now()}.js`
        const downloadDir = os.tmpdir() + '/' + 'CloudStorageCache.test.1'
        await clearDirectory(downloadDir)
        const downloadFilePath = downloadDir + '/' + 'retrievedFile.txt'

        const cache = new CloudStorageCache()
        await expect(cache.downloadToFile(fileUrl, downloadFilePath)).resolves.toBe(false)
        await cache.store(fileUrl, fileContentBuf, 'abc123')
        await expect(cache.downloadToFile(fileUrl, downloadFilePath, true)).resolves.toBe(true)
        const retrievedContent = await fs.promises.readFile(downloadFilePath, 'utf8')
        expect(retrievedContent).toBe(fileContent)
        await expect(cache.etag(fileUrl)).resolves.toBe('abc123')
    })

    await t.test('CloudStorageCache saves files', async () => {
        const fileUrl = `dir1/theFile.${Date.now()}.js`
        const downloadDir = os.tmpdir() + '/' + 'CloudStorageCache.test.1'
        await clearDirectory(downloadDir)
        const downloadFilePath = downloadDir + '/' + 'retrievedFile.txt'

        const cache = new CloudStorageCache()
        await expect(cache.downloadToFile(fileUrl, downloadFilePath)).resolves.toBe(false)
        await cache.store(fileUrl, fileContentBuf)
        await expect(cache.downloadToFile(fileUrl, downloadFilePath, true)).resolves.toBe(true)
        const retrievedContent = await fs.promises.readFile(downloadFilePath, 'utf8')
        expect(retrievedContent).toBe(fileContent)
    })

    await t.test('CloudStorageCache saves and retrieves etag if file exists and has sourceEtag', async () => {
        const fileUrl2 = `dir2/theFile.${Date.now()}.js`
        const nonExistentFileUrl = `dir3/theFile.${Date.now()}.js`
        const downloadDir = os.tmpdir() + '/' + 'CloudStorageCache.test.2'
        await clearDirectory(downloadDir)

        const cache = new CloudStorageCache()
        const etag = 'etag99'
        await cache.store(fileUrl2, fileContentBuf, etag)
        await expect(cache.etag(fileUrl2)).resolves.toBe(etag)
        await expect(cache.etag(nonExistentFileUrl)).resolves.toBe(undefined)
    })

    await t.test('CloudStorageCache clears files', async () => {
        const fileUrl1 = `dir1/theFile.${Date.now()}.js`
        const fileUrl2 = `dir2/theFile.${Date.now()}.js`
        const downloadDir = os.tmpdir() + '/' + 'CloudStorageCache.test.3'
        await fs.promises.rm(downloadDir, {force: true, recursive: true})
        await fs.promises.mkdir(downloadDir)
        const downloadFilePath = downloadDir + '/' + 'retrievedFile.txt'

        const cache = new CloudStorageCache()
        await cache.store(fileUrl1, fileContentBuf, 'abc123')
        await cache.store(fileUrl2, fileContentBuf, 'abc123')

        await cache.clear('dir1')
        await expect(cache.downloadToFile(fileUrl1, downloadFilePath)).resolves.toBe(false)
        await expect(cache.downloadToFile(fileUrl2, downloadFilePath, true)).resolves.toBe(true)

        await cache.clear('dir2')
        await expect(cache.downloadToFile(fileUrl2, downloadFilePath)).resolves.toBe(false)
    })
})