import createAppServer from './appServer.js'
import createAdminServer from './adminServer.js'
import createPreviewServer from './previewServer.js'
import createInstallServer from './installServer.js'
import express from 'express'
import {AllServerProperties} from './util.js'

export function createServer({app: appProps, admin, preview, install}: AllServerProperties) {
    console.log('createServer')

    const app = express()
    if (appProps) app.use(['/capi'], createAppServer(appProps))
    if (admin) app.use(['/admin'], createAdminServer(admin))
    if (preview) app.use(['/preview'], createPreviewServer(preview))
    if (install) app.use(['/install'], createInstallServer(install))
    return app
}

export function runServer(port: number, props: AllServerProperties) {
    const server = createServer(props)
    return server.listen(port)
}
