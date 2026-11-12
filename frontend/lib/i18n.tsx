'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { API_URL, apiFetch } from './api';

/**
 * Interface texts in Portuguese and English. Whole sentences written for each
 * language (not word-by-word translation). Generic web terms (Upload, Login,
 * Logout, Chat, E-mail) stay in English in both.
 *
 * The language is a per-user preference (Account page), stored by the backend;
 * before signing in, the installation default is used.
 */
export type Language = 'pt' | 'en';

const en = {
  // common
  'app.title': 'Document LLM Analyzer',
  'common.loading': 'Loading...',
  'common.loadingSession': 'Loading session...',
  'common.mustLogin': 'You must be logged in.',
  'common.goToLogin': 'Go to login',
  'common.backHome': 'Back to home',
  'common.back': '← Back',
  'common.goBack': 'Go back',
  'common.error': 'Error: {message}',
  'common.requestFailed': 'Request failed',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.name': 'Name',
  'common.email': 'E-mail',
  'common.password': 'Password',
  'common.atLeast8': '(at least 8 characters)',
  'role.admin': 'Administrator',
  'role.user': 'User',
  'footer.local': 'This program runs entirely on this machine.',

  // home
  'home.hello': 'Hello, {name}',
  'home.upload': 'Upload document',
  'home.documents': 'My documents',
  'home.users': 'Users',
  'home.account': 'Account',
  'home.logout': 'Logout',

  // login / setup
  'login.subtitle': 'Sign in with your account.',
  'login.submit': 'Login',
  'login.submitting': 'Signing in...',
  'login.forgot': 'Forgot your password? Ask your administrator to reset it.',
  'setup.title': 'Welcome',
  'setup.subtitle': 'Create the administrator account to start.',
  'setup.hint': 'Using the app by yourself? This is your account. In a company, the administrator adds the other users later, under "Users".',
  'setup.confirm': 'Confirm password',
  'setup.mismatch': 'The passwords do not match.',
  'setup.failed': 'Could not create the account.',
  'setup.submit': 'Create account',
  'setup.submitting': 'Creating...',

  // account
  'account.title': 'Account',
  'account.role': 'Role',
  'account.language': 'Language',
  'account.languageHint': 'Language of the screens and of the explanations and answers written for you.',
  'account.languageSaved': 'Language changed.',
  'account.changePassword': 'Change password',
  'account.current': 'Current password',
  'account.new': 'New password',
  'account.confirmNew': 'Confirm new password',
  'account.mismatch': 'The new passwords do not match.',
  'account.changed': 'Password changed.',
  'account.saving': 'Saving...',

  // users
  'users.title': 'Users',
  'users.intro': 'People who can sign in to this installation. Each user sees their own documents and those shared with their teams.',
  'users.onlyAdmins': 'Only administrators can manage users.',
  'users.you': 'You',
  'users.noPassword': 'No password yet',
  'users.resetPassword': 'Reset password',
  'users.setPassword': 'Set password',
  'users.newPasswordPlaceholder': 'New password (8+ characters)',
  'users.passwordSet': 'New password set. Give it to {name}.',
  'users.add': 'Add user',
  'users.adding': 'Adding...',
  'users.initialPassword': 'Initial password',
  'users.initialPasswordHint': '(at least 8 characters; they can change it under Account)',
  'users.roleUser': 'User: uploads and queries their own documents',
  'users.roleAdmin': 'Administrator: also manages users',
  'users.added': '{name} can now sign in with {email} and the password you chose.',

  // upload
  'upload.title': 'Upload Document',
  'upload.mustLogin': 'You must be logged in to upload documents.',
  'upload.select': 'Select file',
  'upload.change': 'Change file',
  'upload.hint': 'Choose or drag your PDF/image here (max. 20MB)',
  'upload.selected': 'Selected:',
  'upload.submit': 'Upload',
  'upload.uploading': 'Uploading',
  'upload.background': 'After uploading, the document opens and is read in the background.',
  'upload.open': 'Open the document',
  'upload.unsupported': 'Unsupported file type. Choose a PDF or an image (png, jpg, webp, bmp, tiff).',
  'upload.tooLarge': 'File is too large ({size}). The limit is 20 MB.',

  // documents list
  'documents.title': 'My documents',
  'documents.mustLogin': 'You must be logged in to see your documents.',
  'documents.empty': 'No documents yet.',
  'documents.uploadFirst': 'Upload your first one',
  'status.queue': 'In the queue',
  'status.reading': 'Reading',
  'status.failed': 'Could not be read',
  'status.writing': 'Writing explanation',
  'status.readyNoExplanation': 'Ready (no explanation)',
  'status.ready': 'Ready',

  // document page
  'doc.queue': 'In the queue: this document will be read shortly',
  'doc.reading': 'Reading the document (text and OCR)',
  'doc.readFailed': 'Could not read this document: {reason}',
  'doc.retry': 'Retry',
  'doc.writing': 'Writing the explanation',
  'doc.writingAskNow': 'You can already ask questions below.',
  'doc.explainFailed': 'The explanation could not be written: {reason} You can still ask questions.',
  'doc.retryExplanation': 'Retry explanation',
  'doc.unknownError': 'unknown error.',
  'doc.reprocess': 'Reprocess',
  'doc.reprocessTitle': 'Read the document and write the explanation again (e.g. after changing the model)',
  'doc.reprocessConfirm': 'Read the document and write the explanation again? Your questions and answers are kept.',
  'doc.delete': 'Delete',
  'doc.deleteConfirm':
    'Delete "{name}" permanently?\n\nThe file, the text read from it and all its explanations, questions and answers are erased from this machine. This cannot be undone.',
  'doc.preview': 'Preview of {name}',
  'doc.openPdf': 'Open the PDF in a new tab',
  'doc.explanation': 'Explanation:',
  'doc.readingShort': 'Reading the document',
  'doc.chat': 'Chat',
  'doc.noQuestions': 'No questions yet. Ask the first one below.',
  'doc.you': 'You:',
  'doc.llm': 'LLM:',
  'doc.thinking': 'Thinking',
  'doc.interpreting': 'Interpreting',
  'doc.send': 'Send',
  'doc.placeholder': 'Ask something about the document...',
  'doc.placeholderInterpret': 'Ask for an interpretation (it will be marked as such)...',
  'doc.placeholderNotReady': 'Available once the document is read',
  'doc.interpretToggle': 'Interpret: let the model analyse beyond what is written (answer marked as interpretation)',
  'doc.interpretationLabel': "[Interpretation] Not stated in the document: this is the model's reading. Check the cited passages.",
  'doc.refusalHint': 'Want the model\'s interpretation instead? Tick "Interpret" below and ask again.',
  'doc.viewTranslation': 'View translation',
  'doc.hideTranslation': 'Hide translation',
  'doc.translating': 'Translating',
  'doc.translationLabel': 'Automatic translation. The original is above.',
  'doc.translationUnverified': '⚠ The translation changed a number or a page citation of the original. Rely on the original.',

  // citations
  'cite.show': 'Show the source on page {page}',
  'cite.source': 'Source: page {page}',
  'cite.showInPdf': 'Show page {page} in the PDF',
  'cite.notGiven': 'The model was not given any text from page {page}: this citation could not be checked.',
  'cite.notStored': 'The source text was not stored for this answer (it was created before sources were saved).',
  'cite.showAll': 'Show all the text the model received from page {page}',
  'cite.showMatching': 'Show only the matching sentence',
  'cite.exact': 'This is the exact text the model received from the document.',
  // teams (administrators, under Users)
  'teams.title': 'Teams',
  'teams.intro': 'Group people (for example, by department) so they can share documents with each other. Until a team exists, nothing about teams is shown to anyone.',
  'teams.none': 'No teams yet.',
  'teams.create': 'Create team',
  'teams.namePlaceholder': 'Team name (e.g. Legal)',
  'teams.noMembers': 'No members yet.',
  'teams.addMember': 'Add',
  'teams.chooseUser': 'Add a person...',
  'teams.removeMember': 'Remove {name} from the team',
  'teams.removeConfirm': 'Remove {name} from "{team}"?\n\nThey lose access to the documents shared with this team.',
  'teams.rename': 'Rename',
  'teams.delete': 'Delete team',
  'teams.deleteConfirm': 'Delete the team "{name}"?\n\nIts members lose access to the documents shared with it. The documents stay with their owners.',
  'teams.sharedCount': 'Documents shared with it: {count}',

  // sharing (document page and list)
  'share.button': 'Share',
  'share.title': 'Share with teams',
  'share.hint': 'Members of the chosen teams see the file and the explanation and ask questions in their own chat. They do not see your questions; only you can reprocess, delete or change the sharing.',
  'share.private': 'Private: only you can see this document.',
  'share.sharedWith': 'Shared with: {teams}',
  'share.saved': 'Sharing updated.',
  'share.sharedBy': 'Shared by {name}. You see the explanation and your own questions only.',
  'documents.sharedTitle': 'Shared with me',
  'documents.sharedEmpty': 'Nothing has been shared with your teams yet.',
  'documents.sharedBy': 'by {name} · {teams}',

  // administrator panel
  'home.panel': 'Admin panel',
  'admin.title': 'Admin panel',
  'admin.intro': 'How the system is doing and how teams are organised. You see the names, owners and status of shared documents, never their content, questions or answers; private documents appear only as a count.',
  'admin.onlyAdmins': 'Only administrators can see the panel.',
  'admin.health': 'System health',
  'admin.refresh': 'Refresh',
  'admin.ok': 'OK',
  'admin.database': 'Database',
  'admin.llm': 'LLM ({model})',
  'admin.llmDown': 'Ollama is not responding at {url}. Start it (the Ollama app or ollama serve).',
  'admin.modelMissing': 'Ollama is running, but the model is not installed. Run: ollama pull {model}',
  'admin.queue': 'Processing',
  'admin.queueDetail': '{queued} in the queue · {reading} being read · {writing} writing the explanation',
  'admin.failures': 'Failures',
  'admin.failuresDetail': '{reading} could not be read · {explanation} without an explanation',
  'admin.storage': 'Storage',
  'admin.storageDetail': '{documents} documents · {size}',
  'admin.missingFiles': '{count} file(s) missing from the disk',
  'admin.usage': 'Documents per person',
  'admin.usageHint': 'A count only: private documents are not listed.',
  'admin.documents': 'Documents',
  'admin.noShared': 'No documents shared with this team.',
  'admin.unshare': 'Remove',
  'admin.unshareConfirm': 'Stop sharing "{name}" with "{team}"?\n\nThe team loses access; the document stays with its owner.',
  'admin.document': 'Document',
  'admin.owner': 'Owner',
  'admin.sharedAt': 'Shared on',
  'admin.status': 'Status',
} as const;

export type MessageKey = keyof typeof en;

const pt: Record<MessageKey, string> = {
  'app.title': 'Document LLM Analyzer',
  'common.loading': 'Carregando...',
  'common.loadingSession': 'Carregando sessão...',
  'common.mustLogin': 'Você precisa estar logado.',
  'common.goToLogin': 'Ir para o login',
  'common.backHome': 'Voltar ao início',
  'common.back': '← Voltar',
  'common.goBack': 'Voltar',
  'common.error': 'Erro: {message}',
  'common.requestFailed': 'A solicitação falhou',
  'common.save': 'Salvar',
  'common.cancel': 'Cancelar',
  'common.close': 'Fechar',
  'common.name': 'Nome',
  'common.email': 'E-mail',
  'common.password': 'Senha',
  'common.atLeast8': '(pelo menos 8 caracteres)',
  'role.admin': 'Administrador',
  'role.user': 'Usuário',
  'footer.local': 'Este programa roda inteiramente nesta máquina.',

  'home.hello': 'Olá, {name}',
  'home.upload': 'Upload de documento',
  'home.documents': 'Meus documentos',
  'home.users': 'Usuários',
  'home.account': 'Conta',
  'home.logout': 'Logout',

  'login.subtitle': 'Entre com a sua conta.',
  'login.submit': 'Login',
  'login.submitting': 'Entrando...',
  'login.forgot': 'Esqueceu a senha? Peça ao administrador para redefini-la.',
  'setup.title': 'Bem-vindo',
  'setup.subtitle': 'Crie a conta de administrador para começar.',
  'setup.hint': 'Vai usar o app sozinho? Esta é a sua conta. Numa empresa, o administrador adiciona os outros usuários depois, em "Usuários".',
  'setup.confirm': 'Confirme a senha',
  'setup.mismatch': 'As senhas não coincidem.',
  'setup.failed': 'Não foi possível criar a conta.',
  'setup.submit': 'Criar conta',
  'setup.submitting': 'Criando...',

  'account.title': 'Conta',
  'account.role': 'Papel',
  'account.language': 'Idioma',
  'account.languageHint': 'Idioma das telas e das explicações e respostas escritas para você.',
  'account.languageSaved': 'Idioma alterado.',
  'account.changePassword': 'Alterar senha',
  'account.current': 'Senha atual',
  'account.new': 'Nova senha',
  'account.confirmNew': 'Confirme a nova senha',
  'account.mismatch': 'As novas senhas não coincidem.',
  'account.changed': 'Senha alterada.',
  'account.saving': 'Salvando...',

  'users.title': 'Usuários',
  'users.intro': 'Pessoas que podem entrar nesta instalação. Cada usuário vê os próprios documentos e os compartilhados com as suas equipes.',
  'users.onlyAdmins': 'Apenas administradores podem gerenciar usuários.',
  'users.you': 'Você',
  'users.noPassword': 'Sem senha ainda',
  'users.resetPassword': 'Redefinir senha',
  'users.setPassword': 'Definir senha',
  'users.newPasswordPlaceholder': 'Nova senha (8+ caracteres)',
  'users.passwordSet': 'Nova senha definida. Passe-a para {name}.',
  'users.add': 'Adicionar usuário',
  'users.adding': 'Adicionando...',
  'users.initialPassword': 'Senha inicial',
  'users.initialPasswordHint': '(pelo menos 8 caracteres; a pessoa pode alterá-la em Conta)',
  'users.roleUser': 'Usuário: faz upload e consulta os próprios documentos',
  'users.roleAdmin': 'Administrador: também gerencia usuários',
  'users.added': '{name} já pode entrar com {email} e a senha que você escolheu.',

  'upload.title': 'Upload de Documento',
  'upload.mustLogin': 'Você precisa estar logado para fazer upload de documentos.',
  'upload.select': 'Escolher arquivo',
  'upload.change': 'Trocar arquivo',
  'upload.hint': 'Escolha ou arraste seu PDF/imagem aqui (máx. 20MB)',
  'upload.selected': 'Selecionado:',
  'upload.submit': 'Upload',
  'upload.uploading': 'Enviando',
  'upload.background': 'Depois do upload, o documento abre e é lido em segundo plano.',
  'upload.open': 'Abrir o documento',
  'upload.unsupported': 'Tipo de arquivo não suportado. Escolha um PDF ou uma imagem (png, jpg, webp, bmp, tiff).',
  'upload.tooLarge': 'Arquivo grande demais ({size}). O limite é 20 MB.',

  'documents.title': 'Meus documentos',
  'documents.mustLogin': 'Você precisa estar logado para ver seus documentos.',
  'documents.empty': 'Nenhum documento ainda.',
  'documents.uploadFirst': 'Faça o upload do primeiro',
  'status.queue': 'Na fila',
  'status.reading': 'Lendo',
  'status.failed': 'Não foi possível ler',
  'status.writing': 'Escrevendo a explicação',
  'status.readyNoExplanation': 'Pronto (sem explicação)',
  'status.ready': 'Pronto',

  'doc.queue': 'Na fila: este documento será lido em instantes',
  'doc.reading': 'Lendo o documento (texto e OCR)',
  'doc.readFailed': 'Não foi possível ler este documento: {reason}',
  'doc.retry': 'Tentar de novo',
  'doc.writing': 'Escrevendo a explicação',
  'doc.writingAskNow': 'Você já pode fazer perguntas abaixo.',
  'doc.explainFailed': 'Não foi possível escrever a explicação: {reason} Você ainda pode fazer perguntas.',
  'doc.retryExplanation': 'Tentar a explicação de novo',
  'doc.unknownError': 'erro desconhecido.',
  'doc.reprocess': 'Reprocessar',
  'doc.reprocessTitle': 'Ler o documento e escrever a explicação de novo (por exemplo, depois de trocar o modelo)',
  'doc.reprocessConfirm': 'Ler o documento e escrever a explicação de novo? Suas perguntas e respostas são mantidas.',
  'doc.delete': 'Excluir',
  'doc.deleteConfirm':
    'Excluir "{name}" permanentemente?\n\nO arquivo, o texto lido dele e todas as explicações, perguntas e respostas são apagados desta máquina. Isso não pode ser desfeito.',
  'doc.preview': 'Prévia de {name}',
  'doc.openPdf': 'Abrir o PDF em outra aba',
  'doc.explanation': 'Explicação:',
  'doc.readingShort': 'Lendo o documento',
  'doc.chat': 'Chat',
  'doc.noQuestions': 'Nenhuma pergunta ainda. Faça a primeira abaixo.',
  'doc.you': 'Você:',
  'doc.llm': 'LLM:',
  'doc.thinking': 'Pensando',
  'doc.interpreting': 'Interpretando',
  'doc.send': 'Enviar',
  'doc.placeholder': 'Pergunte algo sobre o documento...',
  'doc.placeholderInterpret': 'Peça uma interpretação (ela será marcada como tal)...',
  'doc.placeholderNotReady': 'Disponível quando o documento for lido',
  'doc.interpretToggle': 'Interpretar: deixar o modelo analisar além do que está escrito (resposta marcada como interpretação)',
  'doc.interpretationLabel': '[Interpretação] Não está escrito no documento: é a leitura do modelo. Confira os trechos citados.',
  'doc.refusalHint': 'Quer a interpretação do modelo? Marque "Interpretar" abaixo e pergunte de novo.',
  'doc.viewTranslation': 'Ver tradução',
  'doc.hideTranslation': 'Ocultar tradução',
  'doc.translating': 'Traduzindo',
  'doc.translationLabel': 'Tradução automática. O original está acima.',
  'doc.translationUnverified': '⚠ A tradução alterou um número ou uma citação de página do original. Confie no original.',

  'cite.show': 'Mostrar a fonte na página {page}',
  'cite.source': 'Fonte: página {page}',
  'cite.showInPdf': 'Mostrar a página {page} no PDF',
  'cite.notGiven': 'O modelo não recebeu nenhum texto da página {page}: esta citação não pôde ser conferida.',
  'cite.notStored': 'O texto da fonte não foi guardado para esta resposta (ela é anterior ao registro das fontes).',
  'cite.showAll': 'Mostrar todo o texto que o modelo recebeu da página {page}',
  'cite.showMatching': 'Mostrar só a frase correspondente',
  'cite.exact': 'Este é o texto exato que o modelo recebeu do documento.',
  'teams.title': 'Equipes',
  'teams.intro': 'Agrupe pessoas (por exemplo, por setor) para que possam compartilhar documentos entre si. Enquanto não houver equipes, nada sobre elas aparece para ninguém.',
  'teams.none': 'Nenhuma equipe ainda.',
  'teams.create': 'Criar equipe',
  'teams.namePlaceholder': 'Nome da equipe (ex.: Jurídico)',
  'teams.noMembers': 'Sem membros ainda.',
  'teams.addMember': 'Adicionar',
  'teams.chooseUser': 'Adicionar uma pessoa...',
  'teams.removeMember': 'Tirar {name} da equipe',
  'teams.removeConfirm': 'Tirar {name} de "{team}"?\n\nA pessoa perde o acesso aos documentos compartilhados com esta equipe.',
  'teams.rename': 'Renomear',
  'teams.delete': 'Excluir equipe',
  'teams.deleteConfirm': 'Excluir a equipe "{name}"?\n\nOs membros perdem o acesso aos documentos compartilhados com ela. Os documentos continuam com os donos.',
  'teams.sharedCount': 'Documentos compartilhados com ela: {count}',

  'share.button': 'Compartilhar',
  'share.title': 'Compartilhar com equipes',
  'share.hint': 'Os membros das equipes escolhidas veem o arquivo e a explicação e fazem perguntas no próprio chat. Eles não veem as suas perguntas; só você pode reprocessar, excluir ou mudar o compartilhamento.',
  'share.private': 'Privado: só você vê este documento.',
  'share.sharedWith': 'Compartilhado com: {teams}',
  'share.saved': 'Compartilhamento atualizado.',
  'share.sharedBy': 'Compartilhado por {name}. Você vê a explicação e somente as suas próprias perguntas.',
  'documents.sharedTitle': 'Compartilhados comigo',
  'documents.sharedEmpty': 'Nada foi compartilhado com as suas equipes ainda.',
  'documents.sharedBy': 'de {name} · {teams}',

  'home.panel': 'Painel',
  'admin.title': 'Painel do administrador',
  'admin.intro': 'Como o sistema está e como as equipes estão organizadas. Você vê o nome, o dono e o status dos documentos compartilhados, nunca o conteúdo, as perguntas ou as respostas; documentos privados aparecem só como contagem.',
  'admin.onlyAdmins': 'Apenas administradores podem ver o painel.',
  'admin.health': 'Saúde do sistema',
  'admin.refresh': 'Atualizar',
  'admin.ok': 'OK',
  'admin.database': 'Banco de dados',
  'admin.llm': 'LLM ({model})',
  'admin.llmDown': 'O Ollama não responde em {url}. Inicie-o (o app do Ollama ou ollama serve).',
  'admin.modelMissing': 'O Ollama está no ar, mas o modelo não está instalado. Rode: ollama pull {model}',
  'admin.queue': 'Processamento',
  'admin.queueDetail': '{queued} na fila · {reading} sendo lidos · {writing} escrevendo a explicação',
  'admin.failures': 'Falhas',
  'admin.failuresDetail': '{reading} não puderam ser lidos · {explanation} sem explicação',
  'admin.storage': 'Armazenamento',
  'admin.storageDetail': '{documents} documentos · {size}',
  'admin.missingFiles': '{count} arquivo(s) ausente(s) do disco',
  'admin.usage': 'Documentos por pessoa',
  'admin.usageHint': 'Só a contagem: documentos privados não são listados.',
  'admin.documents': 'Documentos',
  'admin.noShared': 'Nenhum documento compartilhado com esta equipe.',
  'admin.unshare': 'Remover',
  'admin.unshareConfirm': 'Parar de compartilhar "{name}" com "{team}"?\n\nA equipe perde o acesso; o documento continua com o dono.',
  'admin.document': 'Documento',
  'admin.owner': 'Dono',
  'admin.sharedAt': 'Compartilhado em',
  'admin.status': 'Status',
};

const MESSAGES: Record<Language, Record<MessageKey, string>> = { en, pt };

/**
 * Backend messages (English, as APIs usually are) shown in the interface.
 * Exact messages and prefixes; anything unknown is shown as received.
 */
const SERVER_MESSAGES: { match: string | RegExp; pt: string }[] = [
  { match: 'Incorrect e-mail or password.', pt: 'E-mail ou senha incorretos.' },
  { match: /^Too many failed attempts/, pt: 'Muitas tentativas erradas. Espere 15 minutos ou peça ao administrador para redefinir sua senha.' },
  { match: 'The administrator account already exists. Sign in instead.', pt: 'A conta de administrador já existe. Faça login.' },
  { match: 'Enter a valid e-mail address.', pt: 'Digite um e-mail válido.' },
  { match: 'Enter a name.', pt: 'Digite um nome.' },
  { match: 'The password must have at least 8 characters.', pt: 'A senha precisa ter pelo menos 8 caracteres.' },
  { match: 'A user with this e-mail already exists.', pt: 'Já existe um usuário com este e-mail.' },
  { match: 'The current password is incorrect.', pt: 'A senha atual está incorreta.' },
  { match: 'User not found.', pt: 'Usuário não encontrado.' },
  { match: 'Only administrators can do this.', pt: 'Apenas administradores podem fazer isso.' },
  { match: 'Document not found', pt: 'Documento não encontrado.' },
  { match: 'Answer not found', pt: 'Resposta não encontrada.' },
  { match: 'Question must not be empty', pt: 'A pergunta não pode ficar vazia.' },
  { match: 'This document is already being processed.', pt: 'Este documento já está sendo processado.' },
  { match: 'This document is being processed. Wait for it to finish, then delete it.', pt: 'Este documento está sendo processado. Espere terminar e depois exclua.' },
  { match: 'The document must be read before it can be explained.', pt: 'O documento precisa ser lido antes de ser explicado.' },
  { match: /^Document is not ready for questions/, pt: 'O documento ainda não está pronto para perguntas.' },
  { match: /^Unsupported file type\. Upload/, pt: 'Tipo de arquivo não suportado. Envie um PDF ou uma imagem (png, jpg, jpeg, webp, bmp, tiff).' },
  { match: /^No file uploaded/, pt: 'Nenhum arquivo enviado.' },
  { match: /^No readable text was found/, pt: 'Não foi encontrado texto legível neste documento. Se for uma foto ou digitalização, tente uma imagem mais nítida, bem iluminada e com a página ocupando o quadro.' },
  { match: /^Unsupported file type: /, pt: 'Tipo de arquivo não suportado.' },
  { match: /^LLM unavailable: /, pt: 'LLM indisponível: ' },
  { match: 'Language must be "pt" or "en".', pt: 'O idioma deve ser "pt" ou "en".' },
  { match: 'Enter a team name.', pt: 'Digite o nome da equipe.' },
  { match: 'The team name must have at most 60 characters.', pt: 'O nome da equipe pode ter no máximo 60 caracteres.' },
  { match: 'A team with this name already exists.', pt: 'Já existe uma equipe com este nome.' },
  { match: 'Team not found.', pt: 'Equipe não encontrada.' },
  { match: 'Sharing not found.', pt: 'Compartilhamento não encontrado.' },
  { match: 'You can only share with teams you belong to.', pt: 'Você só pode compartilhar com equipes das quais participa.' },
];

export function translateServerMessage(message: string, language: Language): string {
  if (language === 'en' || !message) return message;
  for (const { match, pt: text } of SERVER_MESSAGES) {
    if (typeof match === 'string' ? message === match : match.test(message)) {
      // "LLM unavailable: <technical detail>" keeps the detail
      return text.endsWith(': ') ? text + message.replace(/^LLM unavailable: /, '') : text;
    }
  }
  return message;
}

interface I18n {
  language: Language;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Server messages (errors, failure reasons) in the interface language. */
  server: (message: string) => string;
  setLanguage: (language: Language) => Promise<void>;
}

const I18nContext = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const [language, setLang] = useState<Language>('pt');

  // Signed in: the user's preference. Before signing in: the installation default.
  const email = session?.user?.email;
  useEffect(() => {
    if (status === 'loading') return;
    let cancelled = false;
    const load = email
      ? apiFetch('/auth/me').then((r) => (r.ok ? r.json() : null)).then((me) => me?.language)
      : fetch(`${API_URL}/auth/setup`).then((r) => (r.ok ? r.json() : null)).then((s) => s?.defaultLanguage);
    load
      .then((lang) => !cancelled && (lang === 'en' || lang === 'pt') && setLang(lang))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [email, status]);

  useEffect(() => {
    document.documentElement.lang = language === 'pt' ? 'pt-BR' : 'en';
  }, [language]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      MESSAGES[language][key].replace(/\{(\w+)\}/g, (_, v) => String(vars?.[v] ?? `{${v}}`)),
    [language],
  );
  const server = useCallback((message: string) => translateServerMessage(message, language), [language]);

  const setLanguage = useCallback(async (next: Language) => {
    const res = await apiFetch('/auth/me/language', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: next }),
    });
    if (res.ok) setLang(next);
  }, []);

  return (
    <I18nContext.Provider value={{ language, t, server, setLanguage }}>{children}</I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside LanguageProvider');
  return context;
}
