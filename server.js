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
    const numeroCliente = req.body.From; // ex: 'whatsapp:+5511999998888'

    console.log(`Mensagem recebida de ${numeroCliente}: "${mensagemRecebida}"`);

    // --- Lógica com o Gemini ---
    const prompt = `
        Você é um assistente virtual de uma construtora de alto padrão. Seu nome é Heloísa.
        Sua missão é fazer um primeiro atendimento amigável, qualificar o cliente e encerrar a conversa para que um corretor humano assuma.

        OBJETIVOS:
        1. Apresente-se cordialmente.
        2. Pergunte e colete o NOME do cliente.
        3. Pergunte e colete o EMAIL do cliente.
        4. Pergunte sobre qual empreendimento ele tem interesse (dê opções fictícias como "Residencial Vista do Vale", "Torres do Atlântico").
        5. Ao final, agradeça e informe que um especialista entrará em contato em breve.

        NÃO forneça preços, condições de pagamento ou detalhes técnicos. Apenas qualifique o lead.

        CONVERSA ATUAL:
        Cliente disse: "${mensagemRecebida}"
    `;

    try {
        const result = await model.generateContent(prompt);
        const respostaBot = result.response.text();

        // Envia a resposta de volta para o cliente via Twilio
        await twilioClient.messages.create({
            body: respostaBot,
            from: 'whatsapp:+14155238886', // Número da Sandbox da Twilio
            to: numeroCliente
        });

        console.log(`Resposta enviada para ${numeroCliente}: "${respostaBot}"`);

        // --- "Mágica" para a Demo: Extração de Dados ---
        // Uma lógica simples para "detectar" o fim da conversa e mostrar os dados
        if (respostaBot.toLowerCase().includes("obrigado") || respostaBot.toLowerCase().includes("especialista")) {
             // Numa aplicação real, você faria um parse mais inteligente aqui.
             // Para a demo, vamos simular que os dados foram coletados.
            DADOS_COLETADOS[numeroCliente] = {
                nome: "João Silva (simulado)",
                email: "joao.silva@email.com (simulado)",
                interesse: "Residencial Vista do Vale",
                telefone: numeroCliente
            };
             console.log("\n--- LEAD QUALIFICADO! ---");
             console.log("Dados prontos para enviar para o CRM:");
             console.log(JSON.stringify(DADOS_COLETADOS[numeroCliente], null, 2));
             console.log("-------------------------\n");
        }

        res.status(200).send();

    } catch (error) {
        console.error("Erro ao chamar a API do Gemini ou Twilio:", error);
        res.status(500).send();
    }
});

// --- Inicia o Servidor ---
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor de demonstração rodando na porta ${PORT}. Aguardando conexões da Twilio...`);
});