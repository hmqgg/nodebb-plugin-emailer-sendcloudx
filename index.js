'use strict';

var winston = module.parent.require('winston');
var async = module.parent.require('async');
var nconf = module.parent.require('nconf');
var url = module.parent.require('url');
var Meta = module.parent.require('./meta');
var Posts = module.parent.require('./posts');
var Topics = module.parent.require('./topics');
var Privileges = module.parent.require('./privileges');
var Plugins = module.parent.require('./plugins');
var SocketHelpers = module.parent.require('./socket.io/helpers');
var User = module.parent.require('./user');
var hostEmailer = module.parent.require('./emailer');
var SendCloudX;
var Emailer = {};

Emailer.hostname = url.parse(nconf.get('url')).hostname;
Emailer.receiptRegex = new RegExp('^reply-([\\d]+)@' + Emailer.hostname + '$');

Emailer.init = function (data, callback) {
	var render = function (req, res) {
		var destinationURL = nconf.get('url') + '/plugins/emailer-sendcloudx/webhook';
		res.render('admin/plugins/emailer-sendcloudx', { destinationURL: destinationURL });
	};

	Meta.settings.get('sendcloudx', function (err, settings) {
		if (!err && settings && settings.apiUser && settings.apiKey) {
			if (settings.sendName)
			{
				SendCloudX = require('sendcloud')(settings.apiUser, settings.apiKey, settings.sendName);
			}
			else
			{
				SendCloudX = require('sendcloud')(settings.apiUser, settings.apiKey);
			}
		} else {
			winston.error('[plugins/emailer-sendcloudx] API key not set!');
		}

		data.router.get('/admin/plugins/emailer-sendcloudx', data.middleware.admin.buildHeader, render);
		data.router.get('/api/admin/plugins/emailer-sendcloudx', render);

		if (typeof callback === 'function') {
			callback();
		}
	});
};

Emailer.verifyEvent = function (eventObj, next) {
	var pid = eventObj.to.match(Emailer.receiptRegex);

	if (pid && pid.length && pid[1]) {
		pid = pid[1];
		eventObj.pid = pid;
		Posts.getPostField(pid, 'tid', function (err, tid) {
			if (!err && tid) {
				eventObj.tid = tid;
				next(null, eventObj);
			} else {
				if (!tid) { winston.warn('[emailer.sendcloudx.verifyEvent] Could not retrieve tid'); }
				next(new Error('invalid-data'));
			}
		});
	} else {
		winston.warn('[emailer.sendcloudx.verifyEvent] Could not locate post id');
		next(new Error('invalid-data'), eventObj);
	}
};

Emailer.resolveUserOrGuest = function (eventObj, callback) {
// This method takes the event object, reads the sender email and resolves it to a uid
// if the email is set in the system. If not, and guest posting is enabled, the email
// is treated as a guest instead.
	var envelope = JSON.parse(eventObj.envelope);
	User.getUidByEmail(envelope.from, function (err, uid) {
		if (err) {
			return callback(err);
		}

		if (uid) {
			eventObj.uid = uid;
			callback(null, eventObj);
		} else {
			// See if guests can post to the category in question
			async.waterfall([
				async.apply(Topics.getTopicField, eventObj.tid, 'cid'),
				function (cid, next) {
					Privileges.categories.groupPrivileges(cid, 'guests', next);
				},
			], function (err, privileges) {
				if (err) {
					return callback(privileges);
				}

				if (privileges['groups:topics:reply']) {
					eventObj.uid = 0;

					if (parseInt(Meta.config.allowGuestHandles, 10) === 1) {
						if (eventObj.msg.from_name && eventObj.msg.from_name.length) {
							eventObj.handle = eventObj.msg.from_name;
						} else {
							eventObj.handle = eventObj.msg.from_email;
						}
					}

					callback(null, eventObj);
				} else {
					// Guests can't post here
					winston.verbose('[emailer.sendcloudx] Received reply by guest to pid ' + eventObj.pid + ', but guests are not allowed to post here.');
					callback(new Error('[[error:no-privileges]]'));
				}
			});
		}
	});
};

Emailer.processEvent = function (eventObj, callback) {
	winston.verbose('[emailer.sendcloudx] Processing incoming email reply by uid ' + eventObj.uid + ' to pid ' + eventObj.pid);
	Topics.reply({
		uid: eventObj.uid,
		toPid: eventObj.pid,
		tid: eventObj.tid,
		content: require('node-email-reply-parser')(eventObj.text, true),
		handle: (eventObj.uid === 0 && eventObj.hasOwnProperty('handle') ? eventObj.handle : undefined),
	}, callback);
};

Emailer.notifyUsers = function (postData, next) {
	var result = {
		posts: [postData],
		privileges: {
			'topics:reply': true,
		},
		'reputation:disabled': parseInt(Meta.config['reputation:disabled'], 10) === 1,
		'downvote:disabled': parseInt(Meta.config['downvote:disabled'], 10) === 1,
	};

	SocketHelpers.notifyOnlineUsers(parseInt(postData.uid, 10), result);
	next();
};


Emailer.send = function (data, callback) {
	if (SendCloudX) {
		Meta.settings.get('sendcloudx', function (err, settings) {
			if (err) {
				return callback(err);
			}

			var headers = {};

			if (data._raw.notification && data._raw.notification.pid && settings.hasOwnProperty('inbound_enabled')) {
				headers['Reply-To'] = 'reply-' + data._raw.notification.pid + '@' + Emailer.hostname;
			}

			async.waterfall([
				function (next) {
					if (data.fromUid) {
						next(null, data.fromUid);
					} else if (data._raw.notification && data._raw.notification.pid) {
						Posts.getPostField(data._raw.notification.pid, 'uid', next);
					} else {
						next(null, false);
					}
				},
				function (uid, next) {
					if (uid === false) { return next(null, {}); }

					User.getSettings(uid, function (err, settings) {
						if (err) {
							return next(err);
						}

						if (settings.showemail) {
							User.getUserFields(parseInt(uid, 10), ['email', 'username'], function (err, userData) {
								if (err) {
									return next(err);
								}

								next(null, userData);
							});
						} else {
							User.getUserFields(parseInt(uid, 10), ['username'], function (err, userData) {
								if (err) {
									return next(err);
								}

								next(null, userData);
							});
						}
					});
				},
				function (userData, next) {
					SendCloudX.send(data.to, data.subject, data.html,{
						toname: data.toName,
						from: data.from,
						fromName: data.from_name || userData.username || undefined,
						plain: data.text,
						headers: headers
					}, next);
				},
			], function (err) {
				if (!err) {
					winston.verbose('[emailer.sendcloudx] Sent `' + data.template + '` email to uid ' + data.uid);
					callback(null, data);
				} else {
					winston.warn('[emailer.sendcloudx] Unable to send `' + data.template + '` email to uid ' + data.uid + '!!');
					winston.warn('[emailer.sendcloudx] Error Stringified:' + JSON.stringify(err));
					callback(err);
				}
			});
		});
	} else {
		winston.warn('[plugins/emailer-sendcloudx] API user and key not set, not sending email as SendCloud object is not instantiated.');
		callback(null, data);
	}
};

Emailer.handleError = function (err, eventObj) {
	var envelope = JSON.parse(eventObj.envelope);

	if (err) {
		switch (err.message) {
		case '[[error:no-privileges]]':
		case 'invalid-data':
			// Bounce a return back to sender
			hostEmailer.sendToEmail('bounce', envelope.from, Meta.config.defaultLang || 'zh-CN', {
				site_title: Meta.config.title || 'NodeBB',
				subject: 'Re: ' + eventObj.subject,
				messageBody: eventObj.html,
			}, function (err) {
				if (err) {
					winston.error('[emailer.sendcloudx] Unable to bounce email back to sender! ' + err.message);
				} else {
					winston.verbose('[emailer.sendcloudx] Bounced email back to sender (' + envelope.from + ')');
				}
			});
			break;
		}
	}
};

Emailer.admin = {
	menu: function (custom_header, callback) {
		custom_header.plugins.push({
			route: '/plugins/emailer-sendcloudx',
			icon: 'fa-envelope-o',
			name: 'Emailer (SendCloud)',
		});

		callback(null, custom_header);
	},
};

module.exports = Emailer;
