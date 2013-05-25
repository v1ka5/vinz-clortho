/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const config = require('./lib/configuration'),
      crypto = require('./lib/crypto'),
        util = require('util'),
emailRewrite = require('./lib/email_rewrite.js'),
        auth = require('./lib/auth'),
        ldap = require('ldapjs'),
      logger = require('./lib/logging.js').logger,
      statsd = require('./lib/statsd');

exports.routes = function () {
  var well_known_last_mod = new Date().getTime();
  return {
    public_key: null,
    private_key: null,
    ttl: null,
    well_known_browserid: function (req, resp) {
      var pk = crypto.pubKey;
      resp.setHeader('Content-Type', 'application/json');
      resp.setHeader('Cache-Control', 'max-age=5, public');
      resp.render('well_known_browserid', {
        public_key: pk,
        layout: false
      });
    },
    provision: function (req, resp) {
      resp.render('provision', {
        user: req.session.email,
        browserid_server: config.get('browserid_server'),
        layout: false});
    },
    provision_key: function (req, resp) {
      if (!req.session || !req.session.email) {
        resp.writeHead(401);
        return resp.end();
      }
      if (!req.body.pubkey || !req.body.duration) {
        resp.writeHead(400);
        return resp.end();
      }

      crypto.cert_key(
        req.body.pubkey,
        req.session.email,
        req.body.duration,
        function(err, cert) {
          if (err) {
            resp.writeHead(500);
            resp.end();
          } else {
            resp.json({ cert: cert });
          }
        });
    },

    /* signin_from_form and check_signin_from_form are used for
       processing form based authentication, used when
       signin_method is 'form' */
    signin_from_form: function (req, resp) {
      var email = (req.query ? req.query.email : null);
      if (email) email = emailRewrite(email);

      resp.render('signin', {
        title: req.gettext("Sign In"),
        email: email
      });
    },

    check_signin_from_form: function (req, resp) {
      var mozillaUser = "";
      if (req.body.user) {
        mozillaUser = emailRewrite(req.body.user).toLowerCase();
      }

      if (!req.body.user || !req.body.pass) {
        resp.writeHead(400);
        return resp.end();
      } else {
        auth.authEmail({
          email: mozillaUser,
          password: req.body.pass
        }, function (err, passed) {
          if (err || ! passed) {
            resp.writeHead(401);
            resp.write('Email or Password incorrect');
          } else {
            req.session.email = req.body.user;
            resp.writeHead(200);
          }
          resp.end();
        });
      }
    },


    // Monitoring End points

    // the ELB (elastic load balancer) check is just to make
    // sure that node returns a response
    elb_check: function(req, res, next) {
      res.setHeader('Content-Type', 'text/plain');
      res.send("OK")
    },

    // checks that we can bind against the LDAP server
    // this check is for our global load balancers so they
    // can add / remove regions if LDAP connectivity drops
    checkStatus: function(req, res, next) {
      var dn   = config.get('ldap_bind_dn'),
          pass = config.get('ldap_bind_password');

      client = ldap.createClient({
        url: config.get("ldap_server_url"),
        connectTimeout: config.get('ldap_server_connect_timeout')
      });

      var start = new Date();
      client.bind(dn, pass, function(err) {
        res.setHeader('Content-Type', 'text/plain');
        if (err) {
          statsd.increment('healthcheck.error');
          // try message, no? has name? no ... "unknown"
          var output = "Error: " + err.name;
          res.send(output);
        } else {
          statsd.increment('healthcheck.ok');
          res.send('OK');
        }
      });
    },

    // QA Only URLs
    signout: function (req, resp) { req.session.reset(); resp.redirect('/'); },

    handle404: function (req, resp) {
      resp.render('404', {
        title: '',
        status: 404,

        layout: null
      });
    }
  };
};
