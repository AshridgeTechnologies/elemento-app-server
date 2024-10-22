import createAppServer from './appServer.js'
import createAdminServer from './adminServer.js'
import createPreviewServer from './previewServer.js'
import express from 'express'
import {AllServerProperties} from './util'


export function createServer({app: appProps, admin, preview}: AllServerProperties) {
    console.log('createServer')

    const app = express()
    app.use(['/app'], createAppServer(appProps))
    app.use(['/admin'], createAdminServer(admin))
    app.use(['/preview'], createPreviewServer(preview))
    return app
}

export function runServer(port: number, props: AllServerProperties) {
    const server = createServer(props)
    server.listen(port)
}
