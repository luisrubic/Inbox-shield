import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.i.carica();
  runApp(const InboxShieldApp());
}

class InboxShieldApp extends StatelessWidget {
  const InboxShieldApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Inbox Shield',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
        darkTheme: ThemeData(useMaterial3: true, brightness: Brightness.dark, colorSchemeSeed: Colors.indigo),
        home: Api.i.token == null ? const LoginPage() : const CasellePage(),
      );
}

void avviso(BuildContext c, Object e) => ScaffoldMessenger.of(c)
  ..hideCurrentSnackBar()
  ..showSnackBar(SnackBar(content: Text('$e')));

Future<bool> conferma(BuildContext c, String titolo, String testo) async =>
    (await showDialog<bool>(
      context: c,
      builder: (_) => AlertDialog(
        title: Text(titolo),
        content: Text(testo),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annulla')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Conferma')),
        ],
      ),
    )) ??
    false;

// ------------------------------------------------------------------ login / registrazione

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _pw = TextEditingController();
  final _server = TextEditingController(text: Api.i.server);
  bool _registra = false, _occupato = false;

  Future<void> _vai() async {
    setState(() => _occupato = true);
    try {
      await Api.i.impostaServer(_server.text);
      final e = _email.text.trim(), p = _pw.text;
      _registra ? await Api.i.registra(e, p) : await Api.i.login(e, p);
      if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const CasellePage()));
    } catch (e) {
      if (mounted) avviso(context, e);
    } finally {
      if (mounted) setState(() => _occupato = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const SizedBox(height: 32),
            Text('Inbox Shield', style: Theme.of(context).textTheme.headlineLarge),
            const SizedBox(height: 24),
            TextField(controller: _server, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Indirizzo del server', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _pw, obscureText: true, decoration: InputDecoration(labelText: 'Password', helperText: _registra ? 'Almeno 10 caratteri' : null, border: const OutlineInputBorder())),
            const SizedBox(height: 16),
            FilledButton(onPressed: _occupato ? null : _vai, child: Text(_registra ? 'Crea account' : 'Accedi')),
            TextButton(onPressed: () => setState(() => _registra = !_registra), child: Text(_registra ? 'Ho già un account' : 'Crea un account')),
          ]),
        ),
      );
}

// ------------------------------------------------------------------ caselle

class CasellePage extends StatefulWidget {
  const CasellePage({super.key});
  @override
  State<CasellePage> createState() => _CasellePageState();
}

class _CasellePageState extends State<CasellePage> {
  List<Map<String, dynamic>> _c = [];
  bool _carico = true;

  @override
  void initState() {
    super.initState();
    _ricarica();
  }

  Future<void> _ricarica() async {
    try {
      final c = await Api.i.caselle();
      if (mounted) setState(() => _c = c);
    } catch (e) {
      if (mounted) {
        avviso(context, e);
        if (Api.i.token == null) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LoginPage()));
      }
    } finally {
      if (mounted) setState(() => _carico = false);
    }
  }

  Future<void> _aggiungi() async {
    final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => const AggiungiCasellaPage()));
    if (ok == true) _ricarica();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Le tue caselle'), actions: [
          IconButton(icon: const Icon(Icons.rule), tooltip: 'Regole', onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ReglePage()))),
          IconButton(
              icon: const Icon(Icons.logout),
              tooltip: 'Esci',
              onPressed: () async {
                await Api.i.esci();
                if (mounted) Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LoginPage()));
              }),
        ]),
        floatingActionButton: FloatingActionButton.extended(onPressed: _aggiungi, icon: const Icon(Icons.add), label: const Text('Aggiungi casella')),
        body: _carico
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _ricarica,
                child: ListView(children: [
                  if (_c.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('Nessuna casella collegata. Tocca "Aggiungi casella".')),
                  for (final c in _c)
                    ListTile(
                      leading: const Icon(Icons.mail_outline),
                      title: Text('${c['indirizzo']}'),
                      subtitle: Text('${c['provider']}'),
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PostaPage(casella: c))),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          if (await conferma(context, 'Scollegare?', 'Rimuovo ${c['indirizzo']} da Inbox Shield (la posta resta dov\'è).')) {
                            await Api.i.rimuoviCasella(c['id'] as int);
                            _ricarica();
                          }
                        },
                      ),
                    ),
                ]),
              ),
      );
}

class AggiungiCasellaPage extends StatefulWidget {
  const AggiungiCasellaPage({super.key});
  @override
  State<AggiungiCasellaPage> createState() => _AggiungiCasellaPageState();
}

class _AggiungiCasellaPageState extends State<AggiungiCasellaPage> {
  final _email = TextEditingController();
  final _pw = TextEditingController();
  Map<String, dynamic>? _cfg;
  bool _occupato = false, _inAttesa = false;
  List<Map<String, dynamic>> _oauth = [];

  @override
  void initState() {
    super.initState();
    Api.i.providerOauth().then((p) {
      if (mounted) setState(() => _oauth = p);
    }).catchError((_) {});
  }

  Future<void> _accediCon(String provider) async {
    try {
      final url = await Api.i.avviaOauth(provider);
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) throw ApiErrore('Non riesco ad aprire il browser.');
      if (mounted) setState(() => _inAttesa = true);
    } catch (e) {
      if (mounted) avviso(context, e);
    }
  }

  Future<void> _rileva() async {
    try {
      final c = await Api.i.autoconfig(_email.text.trim());
      if (mounted) setState(() => _cfg = c);
    } catch (e) {
      if (mounted) avviso(context, e);
    }
  }

  Future<void> _salva() async {
    setState(() => _occupato = true);
    try {
      await Api.i.aggiungiCasella(_email.text.trim(), _pw.text);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) avviso(context, e);
    } finally {
      if (mounted) setState(() => _occupato = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _cfg;
    return Scaffold(
      appBar: AppBar(title: const Text('Aggiungi casella')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        for (final p in _oauth)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: FilledButton.tonalIcon(onPressed: () => _accediCon('${p['provider']}'), icon: const Icon(Icons.login), label: Text('Accedi con ${p['provider'] == 'google' ? 'Google' : 'Microsoft'}')),
          ),
        if (_inAttesa)
          Card(
              child: ListTile(
            title: const Text('Completa l\'accesso nel browser'),
            subtitle: const Text('Quando vedi "Casella collegata", torna qui.'),
            trailing: FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Fatto')),
          )),
        if (_oauth.isNotEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('Oppure con password per le app:', textAlign: TextAlign.center)),
        TextField(controller: _email, keyboardType: TextInputType.emailAddress, onChanged: (_) => setState(() => _cfg = null), onSubmitted: (_) => _rileva(), decoration: const InputDecoration(labelText: 'Indirizzo email', border: OutlineInputBorder())),
        const SizedBox(height: 8),
        OutlinedButton.icon(onPressed: _rileva, icon: const Icon(Icons.auto_fix_high), label: const Text('Rileva impostazioni')),
        if (c != null) ...[
          const SizedBox(height: 12),
          Card(
              child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${c['provider']}', style: const TextStyle(fontWeight: FontWeight.bold)),
              Text('IMAP ${c['imap']['host']}:${c['imap']['port']}  ·  SMTP ${c['smtp']['host']}:${c['smtp']['port']}'),
              if ('${c['nota']}'.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${c['nota']}')),
            ]),
          )),
          const SizedBox(height: 12),
          TextField(controller: _pw, obscureText: true, decoration: const InputDecoration(labelText: 'Password (o password per le app)', border: OutlineInputBorder())),
          const SizedBox(height: 12),
          FilledButton(onPressed: _occupato || c['oauth'] == true ? null : _salva, child: Text(_occupato ? 'Verifico…' : 'Collega')),
        ],
      ]),
    );
  }
}

// ------------------------------------------------------------------ posta

class PostaPage extends StatefulWidget {
  const PostaPage({super.key, required this.casella});
  final Map<String, dynamic> casella;
  @override
  State<PostaPage> createState() => _PostaPageState();
}

class _PostaPageState extends State<PostaPage> {
  List<Map<String, dynamic>> _m = [];
  bool _carico = true, _soloNuove = false;
  int get _id => widget.casella['id'] as int;

  @override
  void initState() {
    super.initState();
    _ricarica();
  }

  Future<void> _ricarica() async {
    setState(() => _carico = true);
    try {
      final m = await Api.i.mail(_id, nonLette: _soloNuove);
      if (mounted) setState(() => _m = m);
    } catch (e) {
      if (mounted) avviso(context, e);
    } finally {
      if (mounted) setState(() => _carico = false);
    }
  }

  Future<void> _applicaRegole() async {
    try {
      final f = await Api.i.applicaRegole(_id);
      if (mounted) {
        avviso(context, f.isEmpty ? 'Nessuna regola applicata.' : f.map((x) => '${x['regola']}: ${x['oggetto']}').join('\n'));
        _ricarica();
      }
    } catch (e) {
      if (mounted) avviso(context, e);
    }
  }

  Future<void> _scrivi() async {
    final a = TextEditingController(), o = TextEditingController(), t = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Nuova mail'),
        content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: a, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'A')),
          TextField(controller: o, decoration: const InputDecoration(labelText: 'Oggetto')),
          TextField(controller: t, maxLines: 5, decoration: const InputDecoration(labelText: 'Testo')),
        ])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annulla')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Invia')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await Api.i.invia(_id, a.text, o.text, t.text);
      if (mounted) avviso(context, 'Mail inviata.');
    } catch (e) {
      if (mounted) avviso(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text('${widget.casella['indirizzo']}'), actions: [
          IconButton(icon: Icon(_soloNuove ? Icons.mark_email_unread : Icons.mark_email_read_outlined), tooltip: 'Solo non lette', onPressed: () {
            _soloNuove = !_soloNuove;
            _ricarica();
          }),
          IconButton(icon: const Icon(Icons.auto_awesome), tooltip: 'Applica regole alle nuove', onPressed: _applicaRegole),
        ]),
        floatingActionButton: FloatingActionButton(onPressed: _scrivi, child: const Icon(Icons.edit)),
        body: _carico
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _ricarica,
                child: ListView(children: [
                  if (_m.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('Nessuna mail.')),
                  for (final m in _m)
                    ListTile(
                      title: Text('${m['oggetto']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: m['letto'] == true ? FontWeight.normal : FontWeight.bold)),
                      subtitle: Text('${m['da']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                      onTap: () async {
                        await Navigator.push(context, MaterialPageRoute(builder: (_) => MailPage(idCasella: _id, uid: m['uid'] as int)));
                        _ricarica();
                      },
                    ),
                ]),
              ),
      );
}

class MailPage extends StatefulWidget {
  const MailPage({super.key, required this.idCasella, required this.uid});
  final int idCasella, uid;
  @override
  State<MailPage> createState() => _MailPageState();
}

class _MailPageState extends State<MailPage> {
  Map<String, dynamic>? _m;
  final _risposta = TextEditingController();
  bool _invio = false;

  @override
  void initState() {
    super.initState();
    Api.i.leggi(widget.idCasella, widget.uid).then((m) {
      if (mounted) setState(() => _m = m);
    }).catchError((e) {
      if (mounted) avviso(context, e);
    });
  }

  Future<void> _rispondi() async {
    final m = _m!;
    if (_risposta.text.trim().isEmpty) return;
    if (!await conferma(context, 'Inviare la risposta?', 'A: ${m['da']}\n\n${_risposta.text}')) return;
    setState(() => _invio = true);
    try {
      await Api.i.rispondi(widget.idCasella, widget.uid, _risposta.text);
      if (mounted) {
        avviso(context, 'Risposta inviata.');
        _risposta.clear();
      }
    } catch (e) {
      if (mounted) avviso(context, e);
    } finally {
      if (mounted) setState(() => _invio = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = _m;
    return Scaffold(
      appBar: AppBar(title: Text(m == null ? '' : '${m['oggetto']}', maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: m == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(16), children: [
              Text('Da: ${m['da']}', style: const TextStyle(fontWeight: FontWeight.bold)),
              const Divider(height: 24),
              SelectableText('${m['testo']}'.isEmpty ? '(nessun testo)' : '${m['testo']}'),
              const Divider(height: 32),
              TextField(controller: _risposta, maxLines: 4, decoration: const InputDecoration(labelText: 'Rispondi', border: OutlineInputBorder())),
              const SizedBox(height: 8),
              FilledButton.icon(onPressed: _invio ? null : _rispondi, icon: const Icon(Icons.send), label: const Text('Invia risposta')),
            ]),
    );
  }
}

// ------------------------------------------------------------------ regole

class ReglePage extends StatefulWidget {
  const ReglePage({super.key});
  @override
  State<ReglePage> createState() => _ReglePageState();
}

class _ReglePageState extends State<ReglePage> {
  List<Map<String, dynamic>> _r = [];

  @override
  void initState() {
    super.initState();
    _ricarica();
  }

  Future<void> _ricarica() async {
    try {
      final r = await Api.i.regole();
      if (mounted) setState(() => _r = r);
    } catch (e) {
      if (mounted) avviso(context, e);
    }
  }

  Future<void> _nuova() async {
    final nome = TextEditingController(), valore = TextEditingController(), cartella = TextEditingController();
    String campo = 'da', azione = 'sposta';
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: const Text('Nuova regola'),
          content: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: nome, decoration: const InputDecoration(labelText: 'Nome')),
            DropdownButtonFormField<String>(
                initialValue: campo,
                decoration: const InputDecoration(labelText: 'Se il campo'),
                items: const [DropdownMenuItem(value: 'da', child: Text('Mittente')), DropdownMenuItem(value: 'oggetto', child: Text('Oggetto')), DropdownMenuItem(value: 'a', child: Text('Destinatario'))],
                onChanged: (v) => set(() => campo = v!)),
            TextField(controller: valore, decoration: const InputDecoration(labelText: 'contiene')),
            DropdownButtonFormField<String>(
                initialValue: azione,
                decoration: const InputDecoration(labelText: 'Allora'),
                items: const [
                  DropdownMenuItem(value: 'sposta', child: Text('Sposta in cartella')),
                  DropdownMenuItem(value: 'segna_letto', child: Text('Segna come letta')),
                  DropdownMenuItem(value: 'importante', child: Text('Contrassegna importante')),
                  DropdownMenuItem(value: 'cestina', child: Text('Cestina')),
                ],
                onChanged: (v) => set(() => azione = v!)),
            if (azione == 'sposta') TextField(controller: cartella, decoration: const InputDecoration(labelText: 'Cartella (deve esistere)')),
          ])),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annulla')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Salva')),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await Api.i.nuovaRegola({'nome': nome.text, 'campo': campo, 'operatore': 'contiene', 'valore': valore.text, 'azione': azione, 'cartella': cartella.text});
      _ricarica();
    } catch (e) {
      if (mounted) avviso(context, e);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Regole')),
        floatingActionButton: FloatingActionButton(onPressed: _nuova, child: const Icon(Icons.add)),
        body: ListView(children: [
          if (_r.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('Nessuna regola. Le regole si applicano alle mail non lette quando tocchi ✨ dentro una casella.')),
          for (final r in _r)
            SwitchListTile(
              title: Text('${r['nome']}'),
              subtitle: Text('${r['campo']} contiene "${r['valore']}" → ${r['azione']}${'${r['cartella']}'.isEmpty ? '' : ' (${r['cartella']})'}'),
              value: r['attiva'] == 1,
              onChanged: (v) async {
                await Api.i.attivaRegola(r['id'] as int, v);
                _ricarica();
              },
              secondary: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    await Api.i.eliminaRegola(r['id'] as int);
                    _ricarica();
                  }),
            ),
        ]),
      );
}
