var _ = require('lodash');
var async = require('async');
var cas = require('connect-cas');
var url = require('url');
var qs = require('qs');

module.exports = casModule;

function casModule(options, callback) {
  return new casModule.CasModule(options, callback);
}

casModule.CasModule = function(options, callback) {
  var apos = options.apos;
  var app = options.app;
  var self = this;
  self._apos = apos;
  self._app = app;
  self._action = '/apos-cas';
  self._options = options;

  self._ticketCache = self._apos.getCache('casTickets');
  self.middleware = [];

  // Mix in the ability to serve assets and templates
  self._apos.mixinModuleAssets(self, 'cas', __dirname, options);

  // Your CAS server's hostname must be the "host" property of this object
  cas.configure(options.client);

  if (options.client) {
    // This route has the serviceValidate middleware, which verifies
    // that CAS authentication has taken place, and also the
    // authenticate middleware, which requests it if it has not already
    // taken place.

    self._app.get('/login', cas.serviceValidate(), cas.authenticate(), function(req, res) {
      var user;
      return self.unserialize(req, function(err, user) {
        if (err) {
          console.error(err);
          req.session.destroy();
          return res.send(self.renderPage(req, 'insufficient', {}, 'anon'));
        }
        req.user = user;
        return self._apos.authRedirectAfterLogin(req, function(url) {
          return res.redirect(url);
        });
      });
    });

    // Access to other modules
    self.setBridge = function(bridge) {
      self._bridge = bridge;
    };

    self.unserialize = function(req, callback) {
      var user;
      if ((!req.session.cas) || (!req.session.cas.user)) {
        return callback(null);
      }
      return async.series({
        fetchUser: function(outerCallback) {
          var users = self._apos.authHardcodedUsers(options.site.options);
          var people = self._bridge['apostrophe-people'];
          var group;
          // TODO: duplicating this here is ugly
          var _user = _.find(users, function(user) {
            return (user.username === req.session.cas.user) || (user.email === req.session.cas.user);
          });
          if (_user) {
            // For the convenience of mongodb (it's unique)
            _user._id = _user.username;
            user = _user;
            return outerCallback(null);
          }
          return async.series({
            exists: function(callback) {
              return self._apos.pages.findOne({ type: 'person', username: req.session.cas.user }, function(err, person) {
                if (err) {
                  return callback(err);
                }
                if (person) {
                  user = person;
                  // Flag indicating it's not a hardcoded user
                  // (we should think about just killing hardcoded users)
                  user._mongodb = true;
                  return outerCallback(null);
                } else if (!options.client.createPerson) {
                  return callback(new Error('Not a local user'));
                }
                return callback(null);
              });
            },
            ensureGroup: function(callback) {
              if (!options.client.createPerson.group) {
                return callback(null);
              }
              var groups = self._bridge['apostrophe-groups'];
              return groups.ensureExists(req, options.client.createPerson.group.name, options.client.createPerson.group.permissions, function(err, _group) {
                group = _group;
                return callback(err);
              });
            },
            supply: function(callback) {
              // Supply a person
              user = people.newInstance();
              // Flag indicating it's not a hardcoded user
              // (we should think about just killing hardcoded users)
              user._mongodb = true;
              _.extend(user,
                {
                  username: req.session.cas.user,
                  // Terrible default first and last names in case
                  // nothing better can be determined
                  firstName: req.session.cas.user.substr(0, 1),
                  lastName: req.session.cas.user.substr(1),
                  groupIds: group ? [ group._id ] : [],
                  login: true
                }
              );
              return self.beforeCreatePerson(req, cas, user, callback);
            },
            save: function(callback) {
              // Save the new person to the database after the
              // createPerson callback, if any
              people.putOne(req, user, callback);
            },
            after: function(callback) {
              return self.afterCreatePerson(req, cas, user, callback);
            }
          }, outerCallback);
        },
        afterUnserialize: function(callback) {
          return self._apos.authAfterUnserialize(user, callback);
        }
      }, function(err) {
        if (err) {
          return callback(err);
        }
        return callback(null, user);
      });
    };

    self.beforeCreatePerson = function(req, cas, person, callback) {
      if (options.client.createPerson.before) {
        return options.client.createPerson.before(req, cas, user, callback);
      }
      return callback(null);
    };

    self.afterCreatePerson = function(req, cas, person, callback) {
      if (options.client.createPerson.after) {
        return options.client.createPerson.after(req, cas, user, callback);
      }
      return callback(null);
    };

    self._app.get('/logout', function(req, res) {
      if (!req.session) {
        return res.redirect('/');
      }
      req.session.destroy();
      // Send the user to the official campus-wide logout URL
      var options = cas.configure();
      options.pathname = options.paths.logout;
      return res.redirect(url.format(options));
    });

    self.middleware.push(
      function(req, res, next) {
        if (!req.session.cas) {
          return next();
        }
        return self.unserialize(req, function(err, user) {
          if (err) {
            req.session.destroy();
          } else {
            req.user = user;
          }
          return next();
        });
      }
    );
  }

  if (options.server) {
    self._app.all('/cas/login', function(req, res) {
      var service = req.query.service || req.body.service;
      // Service name is a prefix match
      if (!_.find(options.server.services, function(s) {
        return service.substr(0, s.length) === s;
      })) {
        res.statusCode = 403;
        return res.send('invalid service');
      }
      if (req.user) {
        var ticket = self._apos.generateId();
        req.session.casTickets = req.session.casTickets || {};
        req.session.casTickets[service] = ticket;
        return self._ticketCache.set(ticket, req.user.username, function(err) {
          if (err) {
            res.statusCode = 500;
            return res.send('error');
          }
          return res.redirect(service + '?' + qs.stringify({ ticket: ticket }));
        });
      } else {
        req.session.casLoginForService = service;
        return res.redirect('/login');
      }
    });
    self._app.get('/cas/logout', function(req, res) {
      return res.redirect('/logout');
    });
    // This method is pretty dumb because you can't learn
    // the username this way. Clients should use serviceValidate.
    self._app.all('/cas/validate', function(req, res) {
      var ticket = req.query.ticket || req.body.ticket;
      return self._ticketCache.get(ticket, function(err, value) {
        if (err) {
          console.error(err);
          res.statusCode = 500;
          return res.send('no');
        }
        if (!value) {
          return res.send('no\n');
        }
        return res.send('yes\n');
      });
    });
    self._app.all('/cas/serviceValidate', function(req, res) {
      var ticket = req.query.ticket || req.body.ticket;
      return self._ticketCache.get(ticket, function(err, value) {
        if (err) {
          console.error(err);
          res.statusCode = 500;
          return fail(ticket);
        }
        if (!value) {
          return fail(ticket);
        }
        return success(value);
      });

      function fail(ticket) {
        var m = '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">\n' +
         '<cas:authenticationFailure code="INVALID_TICKET">\n' +
         'Ticket ' + ticket + ' not recognized\n' +
         '</cas:authenticationFailure>\n' +
         '</cas:serviceResponse>\n';
         return res.send(m);
      }

      function success(value) {
        var m = '<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">\n' +
         '<cas:authenticationSuccess>\n' +
         '<cas:user>' + self._apos.escapeHtml(value) + '</cas:user>\n' +
         '</cas:authenticationSuccess>\n' +
         '</cas:serviceResponse>\n';
        return res.send(m);
      }
    });

    // Middleware that waits around for the user to log in and
    // then sends them to the intended service
    self.middleware.push(function(req, res, next) {
      if ((!req.session) || (!req.session.casLoginForService)) {
        return next();
      }
      if (req.user) {
        var service = req.session.casLoginForService;
        var ticket = req.session.casTicket;
        delete req.session.casLoginForService;
        delete req.session.casTicket;
        return res.redirect(service + '?' + qs.stringify({ ticket: ticket }));
      }
      return next();
    });
  }

  if (callback) {
    return process.nextTick(callback);
  }
};

