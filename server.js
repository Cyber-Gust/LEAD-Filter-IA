// server.js

// --- 1. Configuração Inicial ---
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- 2. Inicialização dos Serviços ---
const app = express();
app.use(express.urlencoded({ extended: false }));

// Inicializa o cliente da Twilio com as credenciais do ambiente
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Inicializa o cliente do Gemini com a chave de API do ambiente
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// --- 3. Memória da Conversa ---
// Objeto para armazenar as conversas ativas, usando o número do cliente como chave.
const CONVERSAS_ATIVAS = {};

// --- NOVA FUNÇÃO: Lógica de Retentativa com Espera (Exponential Backoff) ---
/**
 * Tenta gerar conteúdo com o modelo, fazendo novas tentativas em caso de sobrecarga (erro 503).
 * @param {string} prompt O prompt a ser enviado para o modelo.
 * @param {number} maxRetries O número máximo de tentativas.
 * @returns {Promise<import('@google/generative-ai').GenerateContentResult>} O resultado da geração de conteúdo.
 */
async function generateContentWithRetry(prompt, maxRetries = 3) {
    let attempt = 0;
    let delay = 1000; // Começa com 1 segundo de espera

    while (attempt < maxRetries) {
        try {
            // Tenta gerar o conteúdo
            const result = await model.generateContent(prompt);
            return result; // Se funcionar, retorna o resultado
        } catch (error) {
            // Verifica se o erro é de sobrecarga (503)
            if (error.status === 503 && attempt < maxRetries - 1) {
                console.warn(`Modelo sobrecarregado (503). Tentando novamente em ${delay / 1000}s... (Tentativa ${attempt + 1}/${maxRetries})`);
                // Espera o tempo de delay
                await new Promise(resolve => setTimeout(resolve, delay));
                // Aumenta o delay para a próxima tentativa (espera exponencial)
                delay *= 2;
                attempt++;
            } else {
                // Se for outro erro ou a última tentativa, lança o erro para ser tratado externamente
                console.error("Erro final ao chamar a API do Gemini após múltiplas tentativas:", error);
                throw error;
            }
        }
    }
    // Lança um erro se todas as tentativas falharem
    throw new Error("Não foi possível obter resposta do modelo após várias tentativas.");
}


// --- 4. Webhook Principal (Onde a Mágica Acontece) ---
app.post('/webhook', async (req, res) => {
    const mensagemRecebida = req.body.Body;
    const numeroCliente = req.body.From; // ex: 'whatsapp:+5511999998888'

    console.log(`\n---------------------------------`);
    console.log(`Mensagem recebida de ${numeroCliente}: "${mensagemRecebida}"`);

    // --- Gerenciamento do Histórico ---
    if (!CONVERSAS_ATIVAS[numeroCliente]) {
        CONVERSAS_ATIVAS[numeroCliente] = {
            historico: `Cliente: ${mensagemRecebida}\n`,
        };
        console.log(`Nova conversa iniciada para ${numeroCliente}.`);
    } else {
        CONVERSAS_ATIVAS[numeroCliente].historico += `Cliente: ${mensagemRecebida}\n`;
    }

    const historicoDaConversa = CONVERSAS_ATIVAS[numeroCliente].historico;

    // --- O Prompt Inteligente para o Gemini ---
    const prompt = `
        Você é Heloísa, uma consultora especialista da nossa construtora de alto padrão. Sua personalidade é carismática, atenciosa e muito humana. Você NUNCA soa como um robô.

        Seu objetivo é ter uma conversa amigável e natural para conhecer o cliente e entender seus interesses. Conduza o diálogo passo a passo, fazendo UMA PERGUNTA POR VEZ.

        **FLUXO DA CONVERSA IDEAL:**
        1. Comece se apresentando de forma calorosa e perguntando o nome do cliente.
        2. Depois de obter o nome, continue a conversa e pergunte o melhor email para contato.
        3. Em seguida, pergunte sobre qual de nossos empreendimentos ele tem interesse. Sugira algumas opções como "Residencial Vista do Vale" ou "Torres do Atlântico" para facilitar.
        4. Quando tiver todas as informações (nome, email, interesse), agradeça de forma personalizada e diga que um especialista entrará em contato em breve com todos os detalhes.

        **REGRAS IMPORTANTES:**
        - Mantenha as respostas curtas e conversacionais. Use emojis sutis (😊, 👋) quando parecer natural.
        - NUNCA forneça preços, condições de pagamento ou detalhes técnicos. Sua função é apenas o primeiro contato.
        - Adapte-se ao que o cliente diz. Se ele fizer uma pergunta, responda antes de continuar o fluxo.

        **HISTÓRICO DA CONVERSA ATUAL:**
        ${historicoDaConversa}

        **Sua Resposta (curta e amigável):**
    `;

    try {
        // --- Geração da Resposta com IA (usando a nova função com retentativa) ---
        const result = await generateContentWithRetry(prompt);
        const respostaBot = result.response.text();

        CONVERSAS_ATIVAS[numeroCliente].historico += `Heloísa: ${respostaBot}\n`;

        // --- Envio da Resposta via Twilio ---
        await twilioClient.messages.create({
            body: respostaBot,
            from: 'whatsapp:+14155238886', // Seu número da Sandbox da Twilio
            to: numeroCliente
        });

        console.log(`Resposta enviada para ${numeroCliente}: "${respostaBot}"`);

        // --- Extração de Dados Reais ao Final da Conversa ---
        if (respostaBot.toLowerCase().includes("especialista entrará em contato")) {
            console.log("\n--- Conversa finalizada. Iniciando extração de dados... ---");
            const promptExtracao = `
                Baseado no seguinte histórico de conversa, extraia o nome do cliente, o email e o empreendimento de interesse.
                Retorne a resposta APENAS em formato JSON. Se alguma informação não for encontrada, use o valor null.
                Exemplo de formato de saída: { "nome": "Fulano de Tal", "email": "fulano@email.com", "interesse": "Residencial Vista do Vale" }
                HISTÓRICO DA CONVERSA:
                ---
                ${CONVERSAS_ATIVAS[numeroCliente].historico}
                ---
            `;

            const extracaoResult = await generateContentWithRetry(promptExtracao);
            let textoExtraido = extracaoResult.response.text();

            let dadosColetados;
            try {
                const match = textoExtraido.match(/\{[\s\S]*\}/);
                if (match) {
                    const jsonString = match[0];
                    dadosColetados = JSON.parse(jsonString);
                    console.log("Dados extraídos com sucesso:", dadosColetados);
                } else {
                    throw new Error("Nenhum objeto JSON encontrado na resposta da IA.");
                }
            } catch (e) {
                console.error("Falha ao interpretar JSON da extração. Usando dados de fallback.", e);
                console.error("Resposta recebida da IA que causou o erro:", textoExtraido);
                dadosColetados = { nome: "Não foi possível extrair", email: "Não foi possível extrair", interesse: "Não foi possível extrair" };
            }

            const dadosFinais = {
                nome: dadosColetados.nome,
                email: dadosColetados.email,
                interesse: dadosColetados.interesse,
                telefone: numeroCliente,
                historicoCompleto: CONVERSAS_ATIVAS[numeroCliente].historico
            };

            console.log("\n--- LEAD QUALIFICADO! ---");
            console.log("Dados prontos para enviar para o CRM:");
            console.log(JSON.stringify(dadosFinais, null, 2));
            console.log("-------------------------\n");
            
            delete CONVERSAS_ATIVAS[numeroCliente];
        }

        res.status(200).send();
    } catch (error) {
        console.error("Erro final no webhook após todas as tentativas:", error);
        res.status(500).send();
    }
});

// --- 5. Inicialização do Servidor ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor de demonstração rodando na porta ${PORT}. Aguardando conexões...`);
});