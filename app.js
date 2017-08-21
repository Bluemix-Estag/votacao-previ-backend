var express = require('express');

var cfenv = require('cfenv');

var fs = require('fs');

var app = express();

var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

app.use(express.static(__dirname + '/public'));

var appEnv = cfenv.getAppEnv();

fs.stat('./vcap-local.json', function(err, stat) {
  if (err && err.code === 'ENOENT') {
    // file does not exist
    console.log('No vcap-local.json');
    initializeAppEnv();
  } else if (err) {
    console.log('Error retrieving local vcap: ', err.code);
  } else {
    vcapLocal = require("./vcap-local.json");
    console.log("Loaded local VCAP", vcapLocal);
    appEnvOpts = {
      vcap: vcapLocal
    };
    initializeAppEnv();
  }
});


// get the app environment from Cloud Foundry, defaulting to local VCAP
function initializeAppEnv() {
  appEnv = cfenv.getAppEnv(appEnvOpts);
  if (appEnv.isLocal) {
    require('dotenv').load();
  }
  if (appEnv.services.cloudantNoSQLDB) {
    initCloudant();
  } else {
    console.error("No Cloudant service exists.");
  }
}


// =====================================
// CLOUDANT SETUP ======================
// =====================================
var dbname = "previ";
var database;

function initCloudant() {
  var cloudantURL = appEnv.services.cloudantNoSQLDB[0].credentials.url || appEnv.getServiceCreds("previ-cloudant-NoSQLDB").url;
  var Cloudant = require('cloudant')({
    url: cloudantURL,
    plugin: 'retry',
    retryAttempts: 10,
    retryTimeout: 500
  });
  // Create the accounts Logs if it doesn't exist
  Cloudant.db.create(dbname, function(err, body) {
    if (err && err.statusCode == 412) {
      console.log("Database already exists: ", dbname);
    } else if (!err) {
      console.log("New database created: ", dbname);
    } else {
      console.log('Cannot create database!');
    }
  });
  database = Cloudant.db.use(dbname);

}


//========================
//CLOUDANT METHODS
//========================

app.post('/login', function(req, res) {

  var cpf = req.body.cpf;
  var senha = req.body.senha;

  res.setHeader('Content-Type', 'application/json');

  database.get('usuarios', {
    revs_info: true
  }, function(err, doc) {
    if (err) {
      console.log(err);
      res.status(500).json({
        error: true,
        description: "Internal Server Error",
        status: 500
      });
    } else {
      var user = null;
      var users = doc.usuarios;

      for (var u of users) {
        if (u.cpf == cpf) {
          user = u;
          break;
        }
      }

      if (user != null) {
        if (user.senha == senha) {
          if (user.votou) {
            res.status(403).json({
              error: true,
              description: "Votação já efetuada pelo usuário",
              status: 403
            });
          } else {
            res.status(200).json({
              error: false,
              user
            });
          }

        } else {
          res.status(403).json({
            error: true,
            description: "Senha incorreta",
            status: 403
          });
        }
      } else {
        res.status(404).json({
          error: true,
          description: "user not found",
          status: 404
        });
      }
    }
  })
});

app.get('/votacao', function(req, res) {

  res.setHeader('Content-Type', 'application/json');

  database.get('votacao', {
    revs_info: true
  }, function(err, doc) {
    if (err) {
      console.log(err);
      res.status(500).json({
        error: true,
        description: "Internal Server Error",
        status: 500
      });
    } else {
      var votacaoAtual;
      var votacoes = doc.votacoes;

      votacaoAtual = votacoes[votacoes.length - 1];

      res.status(200).json({
        error: false,
        votacaoAtual
      });
    }
  })
});


app.post('/votar', function(req, res) {
  var chapa = req.body.chapa;
  var cpf = req.body.cpf;
  res.setHeader('Content-Type', 'application/json');

  database.get('usuarios', {
    revs_info: true
  }, function(err, doc) {
    if (err) {
      console.log(err);
      res.status(500).json({
        error: true,
        description: "Internal Server Error 1",
        status: 500
      });
    } else {
      var usuarios = doc.usuarios;
      var found = false;
      var erro = false;
      for (var i in usuarios) {
        if (usuarios[i].cpf === cpf) {
          if (usuarios[i].votou) {
            erro = true;
            res.status(400).json({
              error: true,
              description: "Usuario ja votou",
              status: 400
            });
          } else {
            found = true;
            usuarios[i].votou = true;
            usuarios[i].voto = chapa
          }
          break;
        }
      }
      if (!erro) {
        if (found) {
          doc.usuarios = usuarios;
          database.insert(doc, 'usuarios', function(err, doc) {
            if (err) {
              console.log(err)
              res.status(500).json({
                error: true,
                description: "Internal Server Error 2",
                status: 500
              });
            } else {
              database.get('votacao', {
                revs_info: true
              }, function(err, doc) {
                if (err) {
                  res.status(500).json({
                    error: true,
                    description: "Internal Server Error 2",
                    status: 500
                  });
                } else {
                  var votacoes = doc.votacoes;
                  var votacaoAtual = votacoes[votacoes.length - 1];
                  var found = false;
                  for (var i in votacaoAtual.chapas) {
                    if (votacaoAtual.chapas[i].id === chapa) {
                      console.log(chapa)
                      console.log(votacaoAtual.chapas[i].id)
                      found = true;
                      votacaoAtual.chapas[i].votos++;
                      break;
                    }
                  }
                  if (found) {
                    votacoes.pop();
                    votacoes.push(votacaoAtual);
                    doc.votacoes = votacoes;
                    console.log(doc)
                    database.insert(doc, 'votacao', function(err, doc) {
                      if (err) {
                        res.status(500).json({
                          error: true,
                          description: "Internal Server Error 3",
                          status: 500
                        });
                      } else {
                        res.status(200).json({
                          error: false,
                          description: "Voto foi computado"
                        });
                      }
                    })
                  } else {
                    res.status(404).json({
                      error: true,
                      description: "Chapa invalida",
                      status: 404
                    });
                  }
                }
              })
            }
          })
        } else {
          res.status(404).json({
            error: true,
            description: "Usuario nao encontrado",
            status: 404
          });
        }
      }
    }
  })
})

app.post('/reset', function(req, res){
  res.setHeader('Content-Type', 'application/json');
  database.get('usuarios', {
    revs_info: true
  }, function(err, doc){
    if(err){
      res.status(500).json({
        error: true,
        description: "Nao foi possivel resetar os usuarios",
        status: 500
      })
    } else {
      for(var i in doc.usuarios){
        doc.usuarios[i].votou = false;
        doc.usuarios[i].voto = "";
      }
      database.insert(doc, 'usuarios', function(err, doc){
        if(err){
          res.status(500).json({
            error: true,
            description: "Nao foi possivel inserir os usuarios",
            status: 500
          })
        } else {
          res.status(200).json({
            error: false,
            description: "Votos resetados"
          })
        }
      })
    }
  })
})
//========================
//========================

app.listen(appEnv.port, '0.0.0.0', function() {
  console.log("server starting on " + appEnv.url);
});
