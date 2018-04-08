<div class="row">
	<div class="col-lg-9">
		<div class="panel panel-default">
			<div class="panel-heading">Emailer (SendCloud)</div>
			<div class="panel-body">
				<p>
					To get started:
				</p>
				<ol>
					<li>
						Register for an account on <a href="https://www.sendcloud.net/">SendCloud</a>. Free-tier is available.
					</li>
					<li>
						Locate your API user and key, enter it into the fields below, and reload/restart your NodeBB
					</li>
				</ol>

				<hr />

				<form role="form" class="emailer-settings">
					<div class="form-group">
						<label for="apiUser">API User</label>
						<input placeholder="Api User here" type="text" class="form-control" id="apiUser" name="apiUser" />
						<label for="apiKey">API Key</label>
						<input placeholder="Api Key here" type="text" class="form-control" id="apiKey" name="apiKey" />
						<label for="sendName">From Name (Optional)</label>
						<input placeholder="From Name here" type="text" class="form-control" id="sendName" name="sendName" />
					</div>
				</form>
			</div>
		</div>
	</div>
	<div class="col-lg-3">
		<div class="panel panel-default">
			<div class="panel-heading">Control Panel</div>
			<div class="panel-body">
				<button class="btn btn-primary" id="save">Save Settings</button>
			</div>
		</div>
	</div>
</div>

<script type="text/javascript">
	require(['settings'], function (Settings) {
		Settings.load('sendcloudx', $('.emailer-settings'));

		$('#save').on('click', function () {
			Settings.save('sendcloudx', $('.emailer-settings'), function () {
				app.alert({
					type: 'success',
					alert_id: 'quickstart-saved',
					title: 'Settings Saved',
					message: 'Please reload your NodeBB to apply these settings',
					clickfn: function () {
						socket.emit('admin.reload');
					},
					timeout: 5000
				});
			});
		});
	});
</script>
