var _ = require('lodash');
var async = require('async');

module.exports = proxyAuthModule;

function proxyAuthModule(options, callback) {
  return new proxyAuthModule.ProxyAuthModule(options, callback);
}

proxyAuthModule.ProxyAuthModule = function(options, callback) {
  var apos = options.apos;
  var app = options.app;
  var self = this;
  self._apos = apos;
  self._app = app;
  self._action = '/apos-proxy-auth';
  self._options = options;

  if (self._options.disabled) {
    return callback && process.nextTick(callback);
  }

  // Mix in the ability to serve assets and templates
  self._apos.mixinModuleAssets(self, 'proxy-auth', __dirname, options);

  self._app.get('/login', function(req, res) {
    var header = req.headers['x-remote-user'];
    if (!header) {
      return res.send('MISCONFIGURED: Apache configuration is not complete. See the documentation of the apostrophe-proxy-auth module. It is possible to disable this module in dev environments.');
    }
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
    var username;
    username = req.headers['x-remote-user'];
    if (!username) {
      return callback(null);
    }
    return async.series({
      fetchUser: function(outerCallback) {
        var users = self._apos.authHardcodedUsers(options.site.options);
        var people = self._bridge['apostrophe-people'];
        var group;
        // Support hardcoded users
        // TODO: duplicating this here is ugly
        var _user = _.find(users, function(user) {
          return (user.username === username);
        });
        if (_user) {
          // For the convenience of mongodb (it's unique)
          _user._id = _user.username;
          user = _user;
          return outerCallback(null);
        }
        // Support regular database users
        return async.series({
          exists: function(callback) {
            return self._apos.pages.findOne({ type: 'person', username: username }, function(err, person) {
              if (err) {
                return callback(err);
              }
              if (person) {
                user = person;
                // Flag indicating it's not a hardcoded user
                // (we should think about just killing hardcoded users)
                user._mongodb = true;
                return outerCallback(null);
              } else if (!options.createPerson) {
                return callback(new Error('Not a local user'));
              }
              return callback(null);
            });
          },
          ensureGroup: function(callback) {
            if (!options.createPerson.group) {
              return callback(null);
            }
            var groups = self._bridge['apostrophe-groups'];
            return groups.ensureExists(req, options.createPerson.group.name, options.createPerson.group.permissions, function(err, _group) {
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
                username: username,
                // Terrible default first and last names in case
                // nothing better can be determined
                firstName: username.substr(0, 1),
                lastName: username.substr(1),
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
      },
      adminOverride: function(callback) {
        if (options.admin && (user.username === options.admin)) {
          user.permissions.admin = true;
        }
        return callback(null);
      }
    }, function(err) {
      if (err) {
        return callback(err);
      }
      return callback(null, user);
    });
  };

  self.beforeCreatePerson = function(req, cas, person, callback) {
    if (options.createPerson.before) {
      return options.createPerson.before(req, cas, user, callback);
    }
    return callback(null);
  };

  self.afterCreatePerson = function(req, cas, person, callback) {
    if (options.createPerson.after) {
      return options.createPerson.after(req, cas, user, callback);
    }
    return callback(null);
  };

  self._app.get('/logout', function(req, res) {
    if (!req.session) {
      return res.redirect('/');
    }
    req.session.destroy();
    // Send the user to the official campus-wide logout URL
    if (options.afterLogout) {
      return res.redirect(options.afterLogout);
    }
  });

  if (callback) {
    return process.nextTick(callback);
  }
};

