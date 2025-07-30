require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- Configurações ---
const app = express();
app.use(express.urlencoded({ extended: false }));

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const DADOS_COLETADOS = {}; // Objeto simples para guardar os dados na memória durante a demo

// --- O Webhook que a Twilio vai chamar ---
app.post('/webhook', async (req, res) => {
    const mensagemRecebida = req.body.Body;
    const numeroCliente = req.body.From;

    console.log(`Mensagem recebida de ${numeroCliente}: "${mensagemRecebida}"`);

    // --- Gerenciamento do Histórico da Conversa ---
    if (!CONVERSAS_ATIVAS[numeroCliente]) {
        // Inicia uma nova conversa se for o primeiro contato
        CONVERSAS_ATIVAS[numeroCliente] = {
            historico: `Cliente: ${mensagemRecebida}\n`,
            dadosColetados: {
                nome: null,
                email: null,
                interesse: null
            }
        };
    } else {
        // Adiciona a nova mensagem ao histórico existente
        CONVERSAS_ATIVAS[numeroCliente].historico += `Cliente: ${mensagemRecebida}\n`;
    }

    const historicoDaConversa = CONVERSAS_ATIVAS[numeroCliente].historico;

    // --- Lógica com o Gemini ---
    const prompt = `
        Você é Heloísa, uma consultora especialista da nossa construtora de alto padrão. Sua personalidade é carismática, atenciosa e muito humana. Você NUNCA soa como um robô.

        Seu objetivo é ter uma conversa amigável e natural para conhecer o cliente e entender seus interesses. Conduza o diálogo passo a passo, fazendo UMA PERGUNTA POR VEZ.

        **FLUXO DA CONVERSA IDEAL:**
        1.  Comece se apresentando de forma calorosa e perguntando o nome do cliente.
        2.  Depois de obter o nome, continue a conversa e pergunte o melhor email para contato.
        3.  Em seguida, pergunte sobre qual de nossos empreendimentos ele tem interesse. Sugira algumas opções como "Residencial Vista do Vale" ou "Torres do Atlântico" para facilitar.
        4.  Quando tiver todas as informações (nome, email, interesse), agradeça de forma personalizada e diga que um especialista entrará em contato em breve com todos os detalhes.

        **REGRAS IMPORTANTES:**
        - Mantenha as respostas curtas, amigáveis e conversacionais. Use emojis sutis (😊, 👋) quando parecer natural.
        - NUNCA forneça preços, condições de pagamento ou detalhes técnicos. Sua função é apenas o primeiro contato.
        - Adapte-se ao que o cliente diz. Se ele fizer uma pergunta, responda antes de continuar o fluxo.

        **HISTÓRICO DA CONVERSA ATUAL:**
        ${historicoDaConversa}

        **Sua Resposta (curta e amigável):**
    `;

    try {
        const result = await model.generateContent(prompt);
        const respostaBot = result.response.text();

        // Adiciona a resposta do bot ao histórico para a próxima interação
        CONVERSAS_ATIVAS[numeroCliente].historico += `Heloísa: ${respostaBot}\n`;

        // Envia a resposta de volta para o cliente via Twilio
        await twilioClient.messages.create({
            body: respostaBot,
            from: 'whatsapp:+14155238886', // Número da Sandbox da Twilio
            to: numeroCliente
        });

        console.log(`Resposta enviada para ${numeroCliente}: "${respostaBot}"`);

        // --- "Mágica" para a Demo (um pouco mais inteligente) ---
        // Vamos apenas simular a extração para o log, a lógica real seria mais complexa
        if (respostaBot.toLowerCase().includes("especialista entrará em contato")) {
            const dadosFinais = {
                nome: "Extraído da Conversa (Simulado)",
                email: "extraido@email.com (Simulado)",
                interesse: "Torres do Atlântico (Simulado)",
                telefone: numeroCliente,
                historicoCompleto: CONVERSAS_ATIVAS[numeroCliente].historico
            };
            console.log("\n--- LEAD QUALIFICADO! ---");
            console.log("Dados prontos para enviar para o CRM:");
            console.log(JSON.stringify(dadosFinais, null, 2));
            console.log("-------------------------\n");
            
            // Limpa a conversa para um novo contato futuro
            delete CONVERSAS_ATIVAS[numeroCliente];
        }

        res.status(200).send();

    } catch (error) {
        console.error("Erro ao chamar a API do Gemini ou Twilio:", error);
        res.status(500).send();
    }
});

// --- Inicia o Servidor ---
const PORT = process.env.PORT || 3000; // O Render vai fornecer o process.env.PORT
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}.`);
});