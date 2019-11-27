var q = require('q')
var crypto = require('crypto')
var moment = require('moment')
var request = require('request')
var nonce = require('nonce')()
var qs = require('querystring')

let ENDPOINT_API = 'https://api_v1.bitcointoyou.com'

let pairsDict = {
  BTCBRL: 'BRLBTC',
  LTCBRL: 'LTC',
  ETHBRL: 'ETH'
}

let config

function B2Y (_config) {
  this.name = 'BitcoinToYou'
  config = _config.b2y
}

B2Y.prototype.setOrderbookListener = function (pairs, callback) {
  setInterval(function () {
    var promises = []
    // console.log(pairs.BTCUSD.alias);
    Object.keys(pairs).forEach(function (pair) {
      promises.push(this.getOrderbook(pairs[pair].alias))
    })
    q.all(promises)
      .then(function (res) {
        callback(res)
      })
  }, 5000)
}

B2Y.prototype.setBalanceListener = function (pairs, callback) {
  setInterval(function () {
    this.getBalance().then(res => {
      callback(res)
    }).catch(err => {
      console.error('ERROR B2Y ' + err)
    })
  }, 10000)
}

B2Y.prototype.setTradesListener = function (pairs, callback) {
  setInterval(function () {
    var promises = []
    Object.keys(pairs).forEach(function (pair) {
      promises.push(this.getTrades(pair))
    })
    q.all(promises)
      .then(function (res) {
        res.forEach(r => {
          // console.log(JSON.stringify(res, undefined, 2));
          callback(r)
        })
      })
      .catch(function (err) {
        console.log(err)
      })
  }, 9000)
}

B2Y.prototype.clearOrders = function (pair) {
  return new Promise((resolve, reject) => {
    this.getOpenOrders(pair).then((orders) => {
      // console.log(JSON.stringify(orders));

      let cancels = []

      orders.buy.forEach(order => {
        // CANCELLING BUY ORDERS
        cancels.push(this.cancelOrder.bind(null, pair, order.id))
      })
      orders.sell.forEach(order => {
        // CANCELLING SELL ORDERS
        cancels.push(this.cancelOrder.bind(null, pair, order.id))
      })

      return cancels.reduce(q.when, q())
    }).then((res) => {
      resolve(res)
    }).catch(err => {
      console.log('ERR = ' + JSON.stringify(err))
      reject(err)
    })
  })
}

B2Y.prototype.getOrderbook = function (pair) {
  return new Promise((resolve, reject) => {
    if (pair === undefined) pair = 'BTCBRL'
    publicRequest(`/orderbook.aspx`, undefined, function (result) {
      try {
        if (!result) {
          reject(new Error('ERROR GETTING TRADES B2Y' + JSON.stringify(result)))
          return
        }
        var orderbook = {}
        orderbook.buy = result.bids
        orderbook.sell = result.asks
        orderbook.buy = orderbook.buy.map(function (order) {
          order.price = order[0]
          order.amount = order[1]
          delete order[1]
          delete order[0]
          return order
        })
        orderbook.sell = orderbook.sell.map(function (order) {
          order.price = order[0]
          order.amount = order[1]
          delete order[1]
          delete order[0]
          return order
        })
      } catch (err) {
        console.log(err)
        reject(err)
        return
      }
      resolve(orderbook)
    }, function (err) {
      console.log('REJECT')
      reject(err)
    })
  })
}

B2Y.prototype.getBalance = function (pair) {
  return new Promise((resolve, reject) => {
    privateRequest('/balance.aspx', undefined, function (result) {
      if (result.success !== '1') {
        reject(new Error('ERROR GETTING BALANCE B2Y' + JSON.stringify(result)))
        return
      }
      var balance = {}
      balance.BRL = parseFloat(result.oReturn[0].BRL)
      balance.BTC = parseFloat(result.oReturn[0].BTC)
      resolve(balance)
    }, function (err) {
      reject(err)
    })
  })
}

B2Y.prototype.getOpenOrders = function (pair) {
  return new Promise((resolve, reject) => {
    if (pair === undefined) pair = 'BTCBRL'
    var params = {
      status: 'OPEN'
    }

    privateRequest('/getorders.aspx', params, function (result) {
      let orders = { buy: [], sell: [] }

      // console.log(result.oReturn.filter(function (order) {
      //   return order.status !== 'EXECUTED'
      // }))

      result.oReturn.filter(function (order) {
        return order.status !== 'EXECUTED' && order.status !== 'CANCELED'
      }).forEach((order) => {
        var orderStruct = {
          id: order.id,
          side: order.action,
          pair: pairsDict[pair],
          price: order.price,
          amount: order.amount,
          timestamp: moment(order.dateCreated),
          exchange: 'B2Y',
          from: 'BTC',
          to: 'BRL'
        }
        orders[order.action].push(orderStruct)
      })
      resolve(orders)
    }, function (err) {
      reject(err)
    })
  })
}

B2Y.prototype.getTrades = function (pair, since) {
  // https://api.bitcointrade.com.br/v1/market/user_orders/list?status=executed_completely&start_date=2017-01-01&end_date=2018-01-01&currency=BTC&type=buy&page_size=100&current_page=1
  // curl --location --request GET "https://api.bitcointrade.com.br/v2/market/user_orders/list?status=executed_completely&start_date=2017-01-01&end_date=2018-01-01&pair=BRLBTC&type=buy&page_size=100&current_page=1" \
  // --header "Content-Type: application/json" \
  // --header "Authorization: ApiToken U2Ft8tNnGwE7t3vvAc4ZxmUsdVkX18x+VrnwAYM249=" \
  // --data ""

  return new Promise((resolve, reject) => {
    if (pair === undefined) pair = 'BTCBRL'
    var params = {
      pair: pairsDict[pair],
      page_size: 300,
      start_date: moment().subtract(12, 'hours').format('YYYY-MM-DD')
      // end_date: moment().format('YYYY-MM-DD'),
    }

    privateRequest('/market/user_orders/list', params, function (result) {
      let orders = []

      if (!result.data) {
        reject(new Error('ERROR GETTING TRADES B2Y' + JSON.stringify(result)))
        return
      }

      result.data.orders.filter(function (order) {
        return order.executed_amount > 0.0
      }).forEach((order) => {
        var orderStruct = {
          // id: order.id,
          side: order.type,
          pair: pairsDict[pair],
          price: order.unit_price,
          fee: order.executed_amount * 0.0035,
          amount: order.executed_amount,
          timestamp: moment(order.create_date),
          from: pair.substring(0, 3),
          to: pair.substring(3, 6)
        }
        orderStruct.amount -= orderStruct.fee
        orders.push(orderStruct)
      })
      resolve(orders)
    }, function (err) {
      reject(err)
    })
  })
}

B2Y.prototype.sendOrder = function (pair, side, price, volume) {
  return new Promise((resolve, reject) => {
    if (pair === undefined) pair = 'BTCBRL'
    var params = {
      pair: pairsDict[pair],
      type: side,
      subtype: 'limited',
      unit_price: price.toPrecision(6),
      amount: volume.toPrecision(6)
    }

    privateRequest('/market/create_order', params, function (result) {
      console.log('ORDER CREATED B2Y: ' + result.data.id)
      resolve(result.data.id)
    }, function (err) {
      console.log('ERROR PLACING ON B2Y ' + err)
      reject(err)
    })
  })
}

B2Y.prototype.cancelOrder = function (pair, id) {
  return new Promise((resolve, reject) => {
    var params = {
      id: id
    }

    privateRequest('/market/user_orders/', params, function (result) {
      console.log('ORDER REMOVED B2Y: ' + id)
      resolve(id)
    }, function (err) {
      reject(err)
    })
  })
}

function privateRequest (method, parameters, success, error) {
  setTimeout(() => {
    if (!parameters) parameters = {}
    let _nonce = nonce()
    var signature = crypto.createHmac('sha256', config.secret)
      .update(_nonce + config.key)
      .digest().toString('base64')
    let options = {
      method: 'POST',
      url: ENDPOINT_API + method,
      form: parameters,
      headers: {
        'nonce': _nonce,
        'key': config.key,
        'signature': signature
      }
    }

    // console.log(options.form)

    request(options, function (err, response, body) {
      // console.log(response.body)
      // Empty response
      if (!err && (typeof body === 'undefined' || body === null)) { err = 'Empty response' }

      if (!isJson(body)) {
        error('Cannot parse BZX body request = ' + body)
        return
      }

      body = JSON.parse(body)

      if (body.success === 0) {
        error(body.message)
        return
      }

      success(body)
    })
  }, getWaitTime())
}

function publicRequest (method, parameters, success, error) {
  let options = {
    method: 'GET',
    url: ENDPOINT_API + method
  }

  // console.log(options);

  request(options, function (err, response, body) {
    if (!err && (typeof body === 'undefined' || body === null)) { err = 'Empty response' }
    if (!err) {
      try {
        success(JSON.parse(body))
      } catch (err) {
        error(err)
      }
    } else { error(err) }
  })
}

function isJson (str) {
  try {
    JSON.parse(str)
  } catch (e) {
    return false
  }
  return true
}

let lastB2Y = new Date().getTime()

let getWaitTime = function () {
  let now = moment()
  let diff = moment().diff(moment(lastB2Y))
  let wait = 0
  if (diff < 1000) {
    wait = 1000 - diff
  }
  lastB2Y = now.valueOf() + wait
  return wait
}

module.exports = B2Y
