import {type NextFunction} from 'express'
import {DecodedIdToken, getAuth} from 'firebase-admin/auth'
import {isObject, isString, mapValues} from 'radash'
import {parseISO} from 'date-fns'

/**
 * NOTE: technical debt - this file is copied in the elemento-app-server project - changes must be synchronized
 */

export const isNumeric = (s: string) : boolean => s!== '' && s.match(/^\d*\.?\d*$/) !== null
export const isBooleanString = (s: string) : boolean => s.match(/true|false/) !== null
const parseParam = (param: string) => {
    if (isNumeric(param)) {
        return parseFloat(param)
    }

    if (isBooleanString(param)) {
        return param === true.toString()
    }

    const date = parseISO(param)
    if (!Number.isNaN(date.getTime())) {
        return date
    }

    return param
}

const convertDataValues = (val: any): any => {
    if (isString(val)) {
        const date = parseISO(val)
        if (!Number.isNaN(date.getTime())) {
            return date
        }
    }

    if (isObject(val)) {
        return mapValues(val, convertDataValues)
    }

    return val
}

export type ServerAppHandler = {
    [key: string]: {func: (...args: Array<any>) => any, update: boolean, argNames: string[]}
}
export type AppFactory = (appName: string, user: DecodedIdToken | null, version: string) => Promise<ServerAppHandler>

export function parseQueryParams(req: {query: { [key: string]: string; }}): object {
    return mapValues(req.query as any, parseParam) as object
}
export function errorHandler (err: any, req: any, res: any, _next: any) {
    const isValidation = err.constructor.name === 'ValidationError'
    const status = err.status ?? (isValidation ? 400 : 500)
    const {message} = err
    console.error(message, isValidation ? '' : err)
    res?.status(status)
    res?.send({error: {status, message}})
}

function responseError(status: number, error: string) {
    const err = new Error(error) as Error & {status: number}
    err.status = status
    return err
}

export async function getCurrentUser(req: any) {
    const authHeader = req.get('Authorization')
    const idToken = authHeader?.match(/Bearer *(.*)$/)[1]
    return idToken ? await getAuth().verifyIdToken(idToken) : null
}

export const requestHandler = (appFactory: AppFactory) => async (req: any, res: any, next: (err?: any) => void) => {
    try {
        const currentUser = await getCurrentUser(req)
        console.log('user id', currentUser?.uid)
        const match = req.path.match(/^\/(\w+)\/(\w+)\/(\w+)$/)
        if (!match) {
            next(responseError(404, 'Not Found'))
            return
        }
        const [, version, appName, functionName] = match
        const handlerApp = await appFactory(appName, currentUser, version)

        const {func, update, argNames} = handlerApp[functionName] ?? {}
        if (!func) {
            next(responseError(404, 'Not Found: ' + functionName))
            return
        }

        if (update && req.method !== 'POST') {
            next(responseError(405, 'Method Not Allowed'))
            return
        }
        const params = req.method === 'GET' ? parseQueryParams(req) : convertDataValues(req.body)
        const argValues = argNames.map((n: string) => params[n])
        const result = await func(...argValues)
        res.json(result)
    } catch (err) {
        next(err)
    }
}

export function logCall(req: any, res: any, next: NextFunction) {
    console.log(req.method, req.url)
    next()
}
