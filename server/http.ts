import fastify from 'fastify'
import fastifyCors from 'fastify-cors'
import { database } from './db'
import { HistoryEvent, parseFlags, allSeries, HistoryEventType } from './parser'

const app = fastify({ logger: true })

app.register(fastifyCors, {
  origin: '*'
})

app.get('/flags/:series', {
  schema: {
    params: {
      series: {
        type: 'string',
        enum: allSeries
      }
    }
  }
}, async (request, reply) => {
  const db = await database

  if (request.query.fresh) {
    await parseFlags(request.params.series)
  }

  reply.header('Cache-Control', 's-,axage=86400, max-age=86400')

  return db.collection('flags').aggregate([
    {
      $match: {
        currentValue: {
          $exists: true
        },
        series: request.params.series
      }
    },
    {
      $lookup: {
        from: 'history',
        as: 'lastUpdated',
        let: { flag: '$flag', series: '$series' },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [ '$flag', '$$flag' ]
              }
            }
          },
          {
            $match: {
              $expr: {
                $eq: [ '$series', '$$series' ]
              }
            }
          },
          {
            $match: {
              type: {
                $ne: HistoryEventType.TrackingBegan
              }
            }
          },
          { $limit: 1 },
          { $sort: { time: -1 } }
        ]
      }
    },
    {
      $addFields: {
        lastUpdated: {
          $arrayElemAt: [ '$lastUpdated.time', 0 ]
        }
      }
    }
  ]).toArray()
})

const stripUndefined = (obj: {[index: string]: any}) => {
  Object.entries(obj).forEach(([key, value]) => {
    if (value === undefined) {
      delete obj[key]
    }
  })

  return obj
}

app.get('/events', async (req) => {
  const db = await database

  return db.collection('history').find(stripUndefined({
    series: req.query.series,
    flag: req.query.flag,
    type: req.query.series ? undefined : { $ne: HistoryEventType.TrackingBegan }
  })).sort({ time: -1 }).limit(100).toArray()
})

app.listen(8080, '0.0.0.0')
  .then(() => console.log('FFlag observer server started'))
  .catch(e => console.error(e))
